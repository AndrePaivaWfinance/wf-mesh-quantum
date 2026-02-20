/**
 * santander-ops (integrado ao mesh)
 *
 * Serviço de integração com Santander.
 * Responsável por:
 * - Captura de DDA (boletos)
 * - Captura de extrato bancário
 * - PIX, Boletos, Comprovantes
 *
 * Rotas: /api/santander/*
 * Env vars: SANTANDER_CLIENT_ID, SANTANDER_CLIENT_SECRET, SANTANDER_ENVIRONMENT,
 *           SANTANDER_CERT_BASE64, SANTANDER_KEY_BASE64
 */

// Functions
import './functions/health';
import './functions/capture';
import './functions/dda';
import './functions/balance';
import './functions/boletos';
import './functions/pix';

console.log('[mesh:santander-ops] Functions registered');
