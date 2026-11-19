const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://admin_db:WZjf5eNhdCX4GJSnsAuF2H1t@127.0.0.1:5432/operadora_production'
});

async function run() {
  await client.connect();
  console.log('Connected to PostgreSQL database');

  // 1. Check current status
  const beforeTx = await client.query(`
    SELECT estado, count(*), coalesce(sum(monto_bruto), 0) as total
    FROM financial_transactions_reconciliation
    WHERE tipo_movimiento = 'RECIBIDO'
    GROUP BY estado;
  `);
  console.log('Transactions Before:', beforeTx.rows);

  const beforeOrders = await client.query(`
    SELECT estado, count(*), coalesce(sum(monto_esperado), 0) as total
    FROM ordenes_pago_pendientes
    GROUP BY estado;
  `);
  console.log('Orders Before:', beforeOrders.rows);

  // 2. Load and apply functions from schema.sql
  const fs = require('fs');
  const path = require('path');
  const schemaContent = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

  // Extract from DROP FUNCTION IF EXISTS fn_conciliar_orden_cliente to end of fn_auto_conciliar_transaccion
  const startMarker = 'DROP FUNCTION IF EXISTS fn_conciliar_orden_cliente(UUID);';
  const endMarker = '-- Función wrapper retrocompatible';

  const startIdx = schemaContent.indexOf(startMarker);
  const endIdx = schemaContent.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Markers not found in schema.sql');
  }

  const functionsSql = schemaContent.slice(startIdx, endIdx);
  console.log('Applying updated PL/pgSQL functions...');
  await client.query(functionsSql);
  console.log('Functions applied successfully.');

  // 3. Reset reconciliations
  console.log('Resetting reconciliations...');
  await client.query(`
    UPDATE financial_transactions_reconciliation
    SET estado = 'DETECTADO',
        cliente_id = NULL,
        cliente_asignado_nombre = NULL,
        orden_conciliada_id = NULL,
        porcentaje_comision = 0.00,
        monto_comision = 0.00,
        monto_neto = monto_bruto,
        conciliado_at = NULL,
        nota_auditoria = NULL
    WHERE tipo_movimiento = 'RECIBIDO';

    UPDATE ordenes_pago_pendientes
    SET estado = 'PENDIENTE',
        transaccion_conciliada_id = NULL,
        alerta_conciliada_id = NULL,
        conciliado_at = NULL,
        conciliado_por = NULL,
        score_similitud = 0.00;
  `);

  // 4. Run fn_conciliar_orden_cliente on all orders
  console.log('Running fn_conciliar_orden_cliente on all orders...');
  const orders = await client.query(`
    SELECT id, codigo_orden, monto_esperado, remitente_reportado, referencia_reportada
    FROM ordenes_pago_pendientes
    ORDER BY created_at ASC;
  `);

  let matchedCount = 0;
  let waitingCount = 0;

  for (const ord of orders.rows) {
    const res = await client.query('SELECT * FROM fn_conciliar_orden_cliente($1::uuid);', [ord.id]);
    const r = res.rows[0];
    if (r && r.conciliado) {
      matchedCount++;
    } else {
      waitingCount++;
    }
  }

  console.log(`Reconciliation completed. Matched: ${matchedCount}, Waiting bank email: ${waitingCount}`);

  // 5. Check status after
  const afterTx = await client.query(`
    SELECT estado, count(*), coalesce(sum(monto_bruto), 0) as total, coalesce(sum(monto_comision), 0) as comision, coalesce(sum(monto_neto), 0) as neto
    FROM financial_transactions_reconciliation
    WHERE tipo_movimiento = 'RECIBIDO'
    GROUP BY estado;
  `);
  console.log('Transactions After:', afterTx.rows);

  const afterOrders = await client.query(`
    SELECT estado, count(*), coalesce(sum(monto_esperado), 0) as total
    FROM ordenes_pago_pendientes
    GROUP BY estado;
  `);
  console.log('Orders After:', afterOrders.rows);

  // 6. Inspect any unmatched or suspicious rows
  const matchedSample = await client.query(`
    SELECT t.remitente_o_contraparte, o.remitente_reportado, t.referencia, o.referencia_reportada, t.monto_bruto, t.estado
    FROM financial_transactions_reconciliation t
    JOIN ordenes_pago_pendientes o ON t.orden_conciliada_id = o.id
    LIMIT 10;
  `);
  console.log('Sample Matches:', matchedSample.rows);

  await client.end();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
