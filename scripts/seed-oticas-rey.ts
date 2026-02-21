/**
 * Seed: Óticas Rey
 *
 * Cadastra o primeiro cliente real no Table Storage.
 * Uso:
 *   npx tsx scripts/seed-oticas-rey.ts
 *
 * Requer OPERACOES_STORAGE_CONNECTION_STRING no .env (ou local.settings.json)
 */

import { config } from 'dotenv';
config(); // load .env

import {
  createClient,
  ClientSystem,
  ClientPlano,
} from '../src/ops/shared/types';
import {
  upsertClient,
  ensureClientTable,
  getClientByCnpj,
} from '../src/ops/shared/storage/clientStorage';

const CNPJ = '36501400000128'; // 36.501.400/0001-28

async function seed() {
  console.log('=== Seed: Óticas Rey ===\n');

  await ensureClientTable();

  // Idempotente — não duplica se já existe
  const existing = await getClientByCnpj(CNPJ);
  if (existing) {
    console.log(`Cliente já existe: ${existing.nome} (${existing.id})`);
    console.log(`  tenantId: ${existing.tenantId}`);
    console.log(`  status:   ${existing.status}`);
    console.log(`  sistema:  ${existing.sistema}`);
    console.log(`  banco:    ${existing.config.banco}`);
    console.log(`  adquir.:  ${existing.config.adquirente}`);
    console.log('\nNenhuma ação necessária.');
    return;
  }

  const client = createClient({
    nome: 'Óticas Rey',
    cnpj: CNPJ,
    email: 'financeiro@oticasrey.com.br', // placeholder — ajustar depois
    sistema: ClientSystem.OMIE,
    plano: ClientPlano.ESSENCIAL,
    config: {
      // ERP — Omie (credenciais deste cliente)
      // omieAppKey e omieAppSecret devem ser preenchidos via PUT /api/bpo/clientes/{id}
      // ou diretamente aqui quando disponíveis.
      omieAppKey: process.env.OMIE_APP_KEY || '',
      omieAppSecret: process.env.OMIE_APP_SECRET || '',

      // Banco — Santander (credenciais deste cliente)
      banco: 'santander',
      bancoAgencia: process.env.SANTANDER_AGENCIA || '',
      bancoConta: process.env.SANTANDER_CONTA || '',

      // Adquirente — Getnet
      adquirente: 'getnet',
      getnetEstabelecimento: process.env.GETNET_ESTABELECIMENTO || '',

      // Notificações
      notificacoes: {
        email: true,
        whatsapp: false,
        resumoDiario: true,
        alertaVencimento: true,
      },
      categoriasCustomizadas: false,
    },
  });

  await upsertClient(client);

  console.log('Cliente criado com sucesso!\n');
  console.log(`  id:        ${client.id}`);
  console.log(`  tenantId:  ${client.tenantId}`);
  console.log(`  nome:      ${client.nome}`);
  console.log(`  cnpj:      ${client.cnpj}`);
  console.log(`  sistema:   ${client.sistema}`);
  console.log(`  plano:     ${client.plano}`);
  console.log(`  status:    ${client.status}`);
  console.log(`  banco:     ${client.config.banco}`);
  console.log(`  adquir.:   ${client.config.adquirente}`);
  console.log(`\nSources derivadas: [omie, santander, getnet]`);
  console.log('\nPróximos passos:');
  console.log('  1. Preencher omieAppKey/omieAppSecret via PUT /api/bpo/clientes/{id}');
  console.log('  2. Preencher credenciais Santander no Key Vault ou ClientConfig');
  console.log('  3. Mudar status para "ativo" quando pronto');
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
