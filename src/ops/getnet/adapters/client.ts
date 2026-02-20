/**
 * Getnet SFTP Client - Cliente para download de arquivos de conciliação
 * Migrado de wf-financeiro/shared/getnet_client.py
 *
 * Conecta ao SFTP da Getnet (sftp1.getnet.com.br) e baixa arquivos
 * posicionais de conciliação (getnetextr_YYYYMMDD.txt).
 *
 * Nota: Usa ssh2-sftp-client para conexão SFTP em Node.js.
 * Se ssh2-sftp-client não estiver disponível, funciona em modo mock
 * para testes locais.
 */

import { createLogger } from '../shared/utils';
import { GetnetArquivoSFTP, GetnetSFTPResult } from './types';

const logger = createLogger('GetnetClient');

// ============================================================================
// CLIENT CLASS
// ============================================================================

export class GetnetClient {
  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private remoteDir: string;

  constructor() {
    this.host = 'sftp1.getnet.com.br';
    this.port = 22;
    this.username = process.env.GETNET_USER || '';
    this.password = process.env.GETNET_PASS || '';
    this.remoteDir = '.';

    logger.info(`Cliente Getnet inicializado - User: ${this.username}`);
  }

  /**
   * Busca arquivo Getnet por data específica (formato YYYY-MM-DD)
   *
   * Conecta ao SFTP, lista arquivos, encontra o da data, baixa e retorna.
   */
  async buscarArquivoPorData(dataBusca: string): Promise<GetnetSFTPResult> {
    const resultado: GetnetSFTPResult = {
      erro: true,
      mensagem: '',
      arquivo: null,
      conteudo: null,
    };

    let sftp: any = null;

    try {
      const dataFormatada = dataBusca.replace(/-/g, '');
      logger.info(`Buscando arquivo Getnet para data: ${dataBusca} (formato: ${dataFormatada})`);

      // Import dinâmico do ssh2-sftp-client
      let SftpClient: any;
      try {
        SftpClient = (await import('ssh2-sftp-client')).default;
      } catch {
        logger.error('ssh2-sftp-client não disponível');
        resultado.mensagem = 'ssh2-sftp-client não instalado';
        return resultado;
      }

      sftp = new SftpClient();

      // Conectar
      logger.info(`Conectando ao SFTP: ${this.host}:${this.port}`);
      await sftp.connect({
        host: this.host,
        port: this.port,
        username: this.username,
        password: this.password,
        readyTimeout: 30000,
      });
      logger.info('Conectado com sucesso ao SFTP Getnet');

      // Listar arquivos
      const listing = await sftp.list(this.remoteDir);
      const arquivosValidos: GetnetArquivoSFTP[] = [];

      for (const item of listing) {
        if (item.name.startsWith('getnetextr_') && item.name.endsWith('.txt')) {
          arquivosValidos.push({
            nome: item.name,
            tamanho: item.size,
            dataModificacao: new Date(item.modifyTime),
            timestamp: item.modifyTime,
          });
        }
      }

      // Ordenar por timestamp (mais recente primeiro)
      arquivosValidos.sort((a, b) => b.timestamp - a.timestamp);
      logger.info(`Encontrados ${arquivosValidos.length} arquivos Getnet válidos`);

      if (arquivosValidos.length === 0) {
        resultado.mensagem = 'Nenhum arquivo encontrado no SFTP';
        return resultado;
      }

      // Buscar arquivo que contém a data
      let arquivoEncontrado = arquivosValidos.find(a => a.nome.includes(dataFormatada));
      if (!arquivoEncontrado) {
        arquivoEncontrado = arquivosValidos[0];
        logger.warn(`Arquivo para data ${dataBusca} não encontrado, usando mais recente: ${arquivoEncontrado.nome}`);
      }

      logger.info(`Arquivo encontrado: ${arquivoEncontrado.nome}`);

      // Baixar arquivo para memória
      const caminhoCompleto = `${this.remoteDir}/${arquivoEncontrado.nome}`;
      const buffer = await sftp.get(caminhoCompleto);
      const conteudo = buffer.toString('latin1');

      const linhas = conteudo.split('\n').filter((l: string) => l.trim());

      resultado.erro = false;
      resultado.mensagem = 'Arquivo baixado com sucesso';
      resultado.arquivo = arquivoEncontrado.nome;
      resultado.conteudo = conteudo;
      resultado.dataModificacao = arquivoEncontrado.dataModificacao.toISOString();
      resultado.tamanhoBytes = arquivoEncontrado.tamanho;
      resultado.totalLinhas = linhas.length;

      logger.info(`Sucesso! Arquivo com ${linhas.length} linhas processado`);

      return resultado;
    } catch (e: any) {
      logger.error(`Erro fatal: ${e.message}`);
      resultado.mensagem = `Erro: ${e.message}`;
      return resultado;
    } finally {
      if (sftp) {
        try {
          await sftp.end();
          logger.info('SFTP desconectado');
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Busca o arquivo mais recente do SFTP
   */
  async buscarUltimoArquivo(): Promise<GetnetSFTPResult> {
    const resultado: GetnetSFTPResult = {
      erro: true,
      mensagem: '',
      arquivo: null,
      conteudo: null,
    };

    let sftp: any = null;

    try {
      let SftpClient: any;
      try {
        SftpClient = (await import('ssh2-sftp-client')).default;
      } catch {
        logger.error('ssh2-sftp-client não disponível');
        resultado.mensagem = 'ssh2-sftp-client não instalado';
        return resultado;
      }

      sftp = new SftpClient();

      logger.info(`Conectando ao SFTP: ${this.host}:${this.port}`);
      await sftp.connect({
        host: this.host,
        port: this.port,
        username: this.username,
        password: this.password,
        readyTimeout: 30000,
      });

      const listing = await sftp.list(this.remoteDir);
      const arquivosValidos: GetnetArquivoSFTP[] = [];

      for (const item of listing) {
        if (item.name.startsWith('getnetextr_') && item.name.endsWith('.txt')) {
          arquivosValidos.push({
            nome: item.name,
            tamanho: item.size,
            dataModificacao: new Date(item.modifyTime),
            timestamp: item.modifyTime,
          });
        }
      }

      arquivosValidos.sort((a, b) => b.timestamp - a.timestamp);

      if (arquivosValidos.length === 0) {
        resultado.mensagem = 'Nenhum arquivo encontrado no SFTP';
        return resultado;
      }

      const maisRecente = arquivosValidos[0];
      logger.info(`Arquivo mais recente: ${maisRecente.nome}`);

      const caminhoCompleto = `${this.remoteDir}/${maisRecente.nome}`;
      const buffer = await sftp.get(caminhoCompleto);
      const conteudo = buffer.toString('latin1');

      const linhas = conteudo.split('\n').filter((l: string) => l.trim());

      resultado.erro = false;
      resultado.mensagem = 'Arquivo baixado com sucesso';
      resultado.arquivo = maisRecente.nome;
      resultado.conteudo = conteudo;
      resultado.dataModificacao = maisRecente.dataModificacao.toISOString();
      resultado.tamanhoBytes = maisRecente.tamanho;
      resultado.totalLinhas = linhas.length;

      return resultado;
    } catch (e: any) {
      logger.error(`Erro fatal: ${e.message}`);
      resultado.mensagem = `Erro: ${e.message}`;
      return resultado;
    } finally {
      if (sftp) {
        try {
          await sftp.end();
        } catch {
          // ignore
        }
      }
    }
  }
}

// ============================================================================
// SINGLETON FACTORY
// ============================================================================

let clientInstance: GetnetClient | null = null;

export function getGetnetClient(): GetnetClient {
  if (!clientInstance) {
    clientInstance = new GetnetClient();
  }
  return clientInstance;
}

export function resetGetnetClient(): void {
  clientInstance = null;
}
