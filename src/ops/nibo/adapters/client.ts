/**
 * Nibo API Client - Cliente completo para API Nibo
 * Migrado de wf-financeiro/shared/nibo_client.py
 *
 * Funcionalidades:
 * - Contas bancárias
 * - Agendamentos (schedules) - contas a pagar/receber
 * - Pagamentos e recebimentos realizados
 * - Clientes, fornecedores, categorias, centros de custo
 * - Extratos bancários e conciliação
 * - Transferências entre contas
 * - Notas fiscais de serviço
 * - Resumo financeiro
 */

import { createLogger, withRetry } from '../shared/utils';
import {
  NiboSchedule,
  NiboPayable,
  NiboReceivable,
  NiboCategory,
  NiboAccount,
  NiboCustomer,
  NiboSupplier,
  NiboCostCenter,
  NiboEmployee,
  NiboPartner,
  NiboStakeholder,
  NiboTransfer,
  NiboBankStatement,
  NiboReconciliation,
  NiboNFSe,
  NiboPayment,
  NiboReceipt,
  NiboFinancialSummary,
  NiboConnectionTest,
  CreateScheduleData,
  CreateTransferData,
  CreateCustomerData,
  CreateSupplierData,
  CreateCategoryData,
  CreateCostCenterData,
  CreateEmployeeData,
} from './types';

const logger = createLogger('NiboClient');

// ============================================================================
// CLIENT CLASS
// ============================================================================

export class NiboClient {
  private apiToken: string;
  private baseUrl: string;
  private headers: Record<string, string>;
  private cachedAccountId: string | null = null;

  constructor(apiToken: string) {
    this.apiToken = apiToken;
    this.baseUrl = 'https://api.nibo.com.br/empresas/v1';
    this.headers = {
      apitoken: this.apiToken,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    logger.info('Nibo client initialized');
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params?: Record<string, string>,
    data?: unknown
  ): Promise<T[]> {
    const url = new URL(`${this.baseUrl}${endpoint}`);

    if (params && method === 'GET') {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    try {
      const response = await withRetry(
        async () => {
          const res = await fetch(url.toString(), {
            method,
            headers: this.headers,
            body: method !== 'GET' && data ? JSON.stringify(data) : undefined,
          });

          if (!res.ok) {
            const error = await res.text();
            throw new Error(`Nibo API error ${res.status}: ${error}`);
          }

          return res.json();
        },
        { maxRetries: 3, delayMs: 1000 }
      );

      // Nibo returns { items: [], count: N } for lists
      if (response && typeof response === 'object' && 'items' in response) {
        return response.items as T[];
      }

      // Single item or array
      if (Array.isArray(response)) {
        return response as T[];
      }

      return [response as T];
    } catch (error) {
      logger.error(`Request failed: ${endpoint}`, error);
      return [];
    }
  }

  private async requestSingle<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    params?: Record<string, string>,
    data?: unknown
  ): Promise<T | null> {
    const results = await this.request<T>(endpoint, method, params, data);
    return results[0] || null;
  }

  private async getAccountId(): Promise<string | null> {
    if (this.cachedAccountId) {
      return this.cachedAccountId;
    }

    const accounts = await this.getAccounts();
    if (accounts.length > 0) {
      this.cachedAccountId = accounts[0].id;
      return this.cachedAccountId;
    }

    logger.error('No accounts found');
    return null;
  }

  // ============================================================================
  // ACCOUNTS (Contas Bancárias)
  // ============================================================================

  async getAccounts(): Promise<NiboAccount[]> {
    return this.request<NiboAccount>('/accounts');
  }

  async getAccountIdByName(accountName: string): Promise<string | null> {
    const accounts = await this.getAccounts();
    const normalizedSearch = accountName.toUpperCase();

    for (const account of accounts) {
      const name = (account.name || '').toUpperCase();
      if (name.includes(normalizedSearch) || normalizedSearch.includes(name)) {
        logger.info(`Account found: ${account.name} -> ${account.id}`);
        return account.id;
      }
    }

    logger.warn(`Account not found: ${accountName}`);
    return null;
  }

  // ============================================================================
  // SCHEDULES (Contas a Pagar/Receber)
  // ============================================================================

  async getSchedules(
    startDate?: string,
    endDate?: string,
    scheduleType?: 'Debit' | 'Credit',
    onlyUnpaid?: boolean
  ): Promise<NiboSchedule[]> {
    const params: Record<string, string> = { $top: '500' };

    if (scheduleType) {
      params.type = scheduleType;
    }

    if (onlyUnpaid) {
      params.isPaid = 'false';
    }

    let schedules = await this.request<NiboSchedule>('/schedules', 'GET', params);

    // Filter by date manually (Nibo has issues with date filters)
    if (startDate && endDate && schedules.length > 0) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      schedules = schedules.filter((s) => {
        if (!s.dueDate) return false;
        const dueDate = new Date(s.dueDate);
        return dueDate >= start && dueDate <= end;
      });
    }

    return schedules;
  }

  async getScheduleById(scheduleId: string): Promise<NiboSchedule | null> {
    return this.requestSingle<NiboSchedule>(`/schedules/${scheduleId}`);
  }

  async getPayables(startDate: string, endDate: string): Promise<NiboPayable[]> {
    const schedules = await this.getSchedules(startDate, endDate, 'Debit');

    return schedules.map((s) => ({
      id: s.scheduleId,
      description: s.description || '',
      dueDate: s.dueDate,
      value: s.value || 0,
      paidValue: s.paidValue || 0,
      openValue: s.openValue || 0,
      status: s.isPaid ? 'Pago' : s.isDued ? 'Vencido' : 'Pendente',
      supplier: typeof s.stakeholder === 'object' ? s.stakeholder?.name || '' : '',
      category: typeof s.category === 'object' ? s.category?.name || '' : '',
      categoryId: typeof s.category === 'object' ? s.category?.id : undefined,
    }));
  }

  async getReceivables(startDate: string, endDate: string): Promise<NiboReceivable[]> {
    const schedules = await this.getSchedules(startDate, endDate, 'Credit');

    return schedules.map((s) => ({
      id: s.scheduleId,
      description: s.description || '',
      dueDate: s.dueDate,
      value: s.value || 0,
      paidValue: s.paidValue || 0,
      openValue: s.openValue || 0,
      status: s.isPaid ? 'Recebido' : s.isDued ? 'Vencido' : 'Pendente',
      customer: typeof s.stakeholder === 'object' ? s.stakeholder?.name || '' : '',
      category: typeof s.category === 'object' ? s.category?.name || '' : '',
      categoryId: typeof s.category === 'object' ? s.category?.id : undefined,
    }));
  }

  async createSchedule(data: CreateScheduleData): Promise<NiboSchedule | null> {
    return this.requestSingle<NiboSchedule>('/schedules', 'POST', undefined, data);
  }

  async createPayable(
    dueDate: string,
    value: number,
    supplierId: string,
    description: string,
    categoryId?: string,
    costCenterId?: string,
    documentNumber?: string,
    notes?: string
  ): Promise<NiboSchedule | null> {
    const data: CreateScheduleData = {
      type: 'Debit',
      dueDate,
      value,
      stakeholderId: supplierId,
      description,
      categoryId,
      costCenterId,
      documentNumber,
      notes,
    };

    return this.createSchedule(data);
  }

  async createReceivable(
    dueDate: string,
    value: number,
    customerId: string,
    description: string,
    categoryId?: string,
    costCenterId?: string,
    documentNumber?: string,
    notes?: string
  ): Promise<NiboSchedule | null> {
    const data: CreateScheduleData = {
      type: 'Credit',
      dueDate,
      value,
      stakeholderId: customerId,
      description,
      categoryId,
      costCenterId,
      documentNumber,
      notes,
    };

    return this.createSchedule(data);
  }

  async updateSchedule(
    scheduleId: string,
    data: Partial<CreateScheduleData>
  ): Promise<NiboSchedule | null> {
    return this.requestSingle<NiboSchedule>(`/schedules/${scheduleId}`, 'PUT', undefined, data);
  }

  async deleteSchedule(scheduleId: string): Promise<boolean> {
    try {
      await this.request(`/schedules/${scheduleId}`, 'DELETE');
      return true;
    } catch {
      return false;
    }
  }

  async markAsPaid(
    scheduleId: string,
    paidDate: string,
    paidValue: number
  ): Promise<boolean> {
    try {
      await this.request(`/schedules/${scheduleId}/pay`, 'POST', undefined, {
        paymentDate: paidDate,
        value: paidValue,
      });
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // PAYMENTS & RECEIPTS (Realizados)
  // ============================================================================

  async getPayments(): Promise<NiboPayment[]> {
    return this.request<NiboPayment>('/payments');
  }

  async getReceipts(): Promise<NiboReceipt[]> {
    return this.request<NiboReceipt>('/receipts');
  }

  // ============================================================================
  // CATEGORIES
  // ============================================================================

  async getCategories(): Promise<NiboCategory[]> {
    return this.request<NiboCategory>('/categories');
  }

  async createCategory(data: CreateCategoryData): Promise<NiboCategory | null> {
    return this.requestSingle<NiboCategory>('/categories', 'POST', undefined, data);
  }

  async updateCategory(
    categoryId: string,
    data: Partial<CreateCategoryData>
  ): Promise<NiboCategory | null> {
    return this.requestSingle<NiboCategory>(`/categories/${categoryId}`, 'PUT', undefined, data);
  }

  // ============================================================================
  // COST CENTERS
  // ============================================================================

  async getCostCenters(): Promise<NiboCostCenter[]> {
    return this.request<NiboCostCenter>('/costcenters');
  }

  async createCostCenter(data: CreateCostCenterData): Promise<NiboCostCenter | null> {
    return this.requestSingle<NiboCostCenter>('/costcenters', 'POST', undefined, data);
  }

  async updateCostCenter(
    costCenterId: string,
    data: Partial<CreateCostCenterData>
  ): Promise<NiboCostCenter | null> {
    return this.requestSingle<NiboCostCenter>(`/costcenters/${costCenterId}`, 'PUT', undefined, data);
  }

  // ============================================================================
  // CUSTOMERS
  // ============================================================================

  async getCustomers(): Promise<NiboCustomer[]> {
    return this.request<NiboCustomer>('/customers');
  }

  async createCustomer(data: CreateCustomerData): Promise<NiboCustomer | null> {
    return this.requestSingle<NiboCustomer>('/customers', 'POST', undefined, data);
  }

  async updateCustomer(
    customerId: string,
    data: Partial<CreateCustomerData>
  ): Promise<NiboCustomer | null> {
    return this.requestSingle<NiboCustomer>(`/customers/${customerId}`, 'PUT', undefined, data);
  }

  // ============================================================================
  // SUPPLIERS
  // ============================================================================

  async getSuppliers(): Promise<NiboSupplier[]> {
    return this.request<NiboSupplier>('/suppliers');
  }

  async createSupplier(data: CreateSupplierData): Promise<NiboSupplier | null> {
    return this.requestSingle<NiboSupplier>('/suppliers', 'POST', undefined, data);
  }

  async updateSupplier(
    supplierId: string,
    data: Partial<CreateSupplierData>
  ): Promise<NiboSupplier | null> {
    return this.requestSingle<NiboSupplier>(`/suppliers/${supplierId}`, 'PUT', undefined, data);
  }

  // ============================================================================
  // EMPLOYEES
  // ============================================================================

  async getEmployees(): Promise<NiboEmployee[]> {
    return this.request<NiboEmployee>('/employees');
  }

  async createEmployee(data: CreateEmployeeData): Promise<NiboEmployee | null> {
    return this.requestSingle<NiboEmployee>('/employees', 'POST', undefined, data);
  }

  async updateEmployee(
    employeeId: string,
    data: Partial<CreateEmployeeData>
  ): Promise<NiboEmployee | null> {
    return this.requestSingle<NiboEmployee>(`/employees/${employeeId}`, 'PUT', undefined, data);
  }

  // ============================================================================
  // PARTNERS
  // ============================================================================

  async getPartners(): Promise<NiboPartner[]> {
    return this.request<NiboPartner>('/partners');
  }

  // ============================================================================
  // STAKEHOLDERS
  // ============================================================================

  async createStakeholder(data: { name: string; document?: string; email?: string; phone?: string }): Promise<NiboStakeholder | null> {
    return this.requestSingle<NiboStakeholder>('/stakeholders', 'POST', undefined, data);
  }

  async updateStakeholder(
    stakeholderId: string,
    data: Partial<{ name: string; document?: string; email?: string; phone?: string }>
  ): Promise<NiboStakeholder | null> {
    return this.requestSingle<NiboStakeholder>(`/stakeholders/${stakeholderId}`, 'PUT', undefined, data);
  }

  // ============================================================================
  // TRANSFERS (Transferências entre Contas)
  // ============================================================================

  async getTransfers(): Promise<NiboTransfer[]> {
    return this.request<NiboTransfer>('/accounts/transfer');
  }

  async createTransfer(data: CreateTransferData): Promise<NiboTransfer | null> {
    logger.info(`Creating transfer: ${data.originAccountId} -> ${data.destinyAccountId} = R$ ${data.value}`);
    const result = await this.requestSingle<NiboTransfer>('/accounts/transfer', 'POST', undefined, data);

    if (result) {
      logger.info('Transfer created successfully');
    } else {
      logger.warn('Failed to create transfer');
    }

    return result;
  }

  async deleteTransfer(transferId: string): Promise<boolean> {
    try {
      await this.request(`/accounts/transfer/${transferId}`, 'DELETE');
      return true;
    } catch {
      return false;
    }
  }

  // ============================================================================
  // BANK STATEMENTS (Extratos)
  // ============================================================================

  async getBankStatement(accountId?: string): Promise<NiboBankStatement[]> {
    const finalAccountId = accountId || (await this.getAccountId());

    if (!finalAccountId) {
      logger.error('Account ID required for bank statement');
      return [];
    }

    return this.request<NiboBankStatement>(`/accounts/${finalAccountId}/views/statement`);
  }

  async getBankStatementAllAccounts(): Promise<NiboBankStatement[]> {
    const accounts = await this.getAccounts();

    if (accounts.length === 0) {
      logger.warn('No bank accounts found');
      return [];
    }

    const allStatements: NiboBankStatement[] = [];

    for (const account of accounts) {
      if (!account.id) continue;

      logger.info(`Fetching statement for: ${account.name} (${account.id})`);

      try {
        const statements = await this.request<NiboBankStatement>(
          `/accounts/${account.id}/views/statement`
        );

        if (statements.length > 0) {
          // Add account info to each statement
          for (const statement of statements) {
            statement._account_id = account.id;
            statement._account_name = account.name;
          }
          allStatements.push(...statements);
          logger.info(`  Found ${statements.length} transactions`);
        }
      } catch (error) {
        logger.warn(`Error fetching statement for ${account.name}: ${error}`);
      }
    }

    logger.info(`Total transactions across all accounts: ${allStatements.length}`);
    return allStatements;
  }

  // ============================================================================
  // RECONCILIATION (Conciliação)
  // ============================================================================

  async getReconciliation(accountId?: string): Promise<NiboReconciliation | null> {
    const finalAccountId = accountId || (await this.getAccountId());

    if (!finalAccountId) {
      logger.error('Account ID required for reconciliation');
      return null;
    }

    return this.requestSingle<NiboReconciliation>(`/accounts/${finalAccountId}/reconciliation`);
  }

  async getReconciliationAllAccounts(): Promise<NiboReconciliation[]> {
    const accounts = await this.getAccounts();

    if (accounts.length === 0) {
      logger.warn('No bank accounts found');
      return [];
    }

    const allReconciliations: NiboReconciliation[] = [];

    for (const account of accounts) {
      if (!account.id) continue;
      if (!account.isReconcilable) {
        logger.info(`Account ${account.name} is not reconcilable, skipping...`);
        continue;
      }

      logger.info(`Fetching reconciliation for: ${account.name} (${account.id})`);

      try {
        const reconciliation = await this.getReconciliation(account.id);

        if (reconciliation) {
          reconciliation._account_id = account.id;
          reconciliation._account_name = account.name;
          allReconciliations.push(reconciliation);
          logger.info(`  Reconciliation data found`);
        }
      } catch (error) {
        logger.warn(`Error fetching reconciliation for ${account.name}: ${error}`);
      }
    }

    logger.info(`Total reconciliations across all accounts: ${allReconciliations.length}`);
    return allReconciliations;
  }

  // ============================================================================
  // NFSe (Notas Fiscais de Serviço)
  // ============================================================================

  async getNFSe(): Promise<NiboNFSe[]> {
    return this.request<NiboNFSe>('/nfse');
  }

  // ============================================================================
  // FINANCIAL SUMMARY
  // ============================================================================

  async getFinancialSummary(daysBack = 30): Promise<NiboFinancialSummary> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    // Fetch data
    const payables = await this.getPayables(startStr, endStr);
    const receivables = await this.getReceivables(startStr, endStr);

    // Calculate totals
    const totalPayables = payables.reduce((sum, p) => sum + (p.value || 0), 0);
    const totalReceivables = receivables.reduce((sum, r) => sum + (r.value || 0), 0);

    const openPayables = payables.reduce((sum, p) => sum + (p.openValue || 0), 0);
    const openReceivables = receivables.reduce((sum, r) => sum + (r.openValue || 0), 0);

    const overduePayables = payables.filter((p) => p.status === 'Vencido');
    const overdueReceivables = receivables.filter((r) => r.status === 'Vencido');

    const todayStr = new Date().toISOString().split('T')[0];
    const todayPayables = payables.filter((p) => p.dueDate?.startsWith(todayStr));

    return {
      period: {
        start: startStr,
        end: endStr,
        days: daysBack,
      },
      payables: {
        total: payables.length,
        value: totalPayables,
        openValue: openPayables,
        overdue: overduePayables.length,
        dueToday: todayPayables.length,
      },
      receivables: {
        total: receivables.length,
        value: totalReceivables,
        openValue: openReceivables,
        overdue: overdueReceivables.length,
      },
      cashFlow: {
        projected: totalReceivables - totalPayables,
        current: openReceivables - openPayables,
      },
      alerts: [],
    };
  }

  // ============================================================================
  // CONNECTION TEST
  // ============================================================================

  async testConnection(): Promise<NiboConnectionTest> {
    try {
      const accounts = await this.getAccounts();

      if (accounts.length > 0) {
        return {
          connected: true,
          apiUrl: this.baseUrl,
          environment: 'production',
          accounts: accounts.length,
          firstAccountId: accounts[0]?.id,
          mode: 'LIVE',
        };
      }

      return {
        connected: false,
        apiUrl: this.baseUrl,
        environment: 'production',
        accounts: 0,
        mode: 'ERROR',
        error: 'No accounts available',
      };
    } catch (error) {
      return {
        connected: false,
        apiUrl: this.baseUrl,
        environment: 'production',
        accounts: 0,
        mode: 'ERROR',
        error: String(error),
      };
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let clientInstance: NiboClient | null = null;

export function getNiboClient(): NiboClient {
  if (!clientInstance) {
    const apiToken = process.env.NIBO_API_KEY;
    if (!apiToken) {
      throw new Error('NIBO_API_KEY not configured');
    }
    clientInstance = new NiboClient(apiToken);
  }
  return clientInstance;
}

export function resetNiboClient(): void {
  clientInstance = null;
}
