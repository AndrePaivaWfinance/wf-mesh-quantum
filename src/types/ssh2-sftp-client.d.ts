/**
 * Declaração mínima para ssh2-sftp-client
 * O pacote é carregado via import dinâmico com fallback em runtime.
 * Esta declaração existe apenas para satisfazer o compilador TypeScript.
 */
declare module 'ssh2-sftp-client' {
  interface FileInfo {
    name: string;
    size: number;
    modifyTime: number;
    accessTime: number;
    type: string;
  }

  interface ConnectOptions {
    host: string;
    port?: number;
    username?: string;
    password?: string;
    readyTimeout?: number;
    privateKey?: string | Buffer;
  }

  class SftpClient {
    connect(options: ConnectOptions): Promise<void>;
    list(remoteFilePath: string): Promise<FileInfo[]>;
    get(path: string): Promise<Buffer>;
    end(): Promise<void>;
  }

  export default SftpClient;
}
