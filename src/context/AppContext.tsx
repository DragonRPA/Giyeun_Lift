import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { db, supabase, Tenant, TenantWorkplace, TenantYard, TenantBusinessType, TenantBankAccount, OFFICIAL_STAMP_BASE64, User, MenuPermission, createMenuPermission, CustomRole, RolePermission, Customer, CustomerContact, CustomerSite, Product, Asset, Consumable, ConsumableLog, ConsumablePurchaseRequest, MechanicConsumableStock, Contract, ContractAsset, ContractHistory, Delivery, Billing, BillingType, BillingDetail, Receivable, Payment, PaymentDepositLink, Repair, RepairConsumable, Todo, BankTransaction, BankMatchingRule, BankAccountInitialBalance, AssetInOutLog, GoogleConfig, Vendor, CashFlowSnapshot, OutboundInspection, TransportCompany, TransportDriver, TransportNegotiation, SubleaseNegotiation, DepreciationLog, PurchaseSettlement, PurchaseSettlementItem, SettlementPaymentLog, ExternalLease, PurchaseSettlementType, PurchaseSettlementStatus, findCustomerByNormalizedName, AnnualLeaveQuota, LeaveUsage, OvertimeRecord, PayrollClosing, InspectionChecklistItem, EquipmentManual, StandardOption, InboundDefectDetail, PrepaidTransaction, DelinquencyActionLog, LegalNoticeLog, LegalNoticeTemplate, calculateAssetDepreciation, FieldAsTicket, FieldAsPartUsed, FieldAsCollectedPart, CorporateVehicle, VehicleOperationLog, VehicleFuelLog, RepairPartUsed, RepairCollectedPart, SaleContractTerms, StocktakingAudit, StocktakingAuditItem, CollectedPart, PrintStation, PrintQueueItem, logPrivacyAccess } from '../services/db';
import { enqueuePrintJob as serviceEnqueuePrintJob, registerPrintStation as serviceRegisterPrintStation, deletePrintStation as serviceDeletePrintStation, retryPrintJob as serviceRetryPrintJob, cancelPrintJob as serviceCancelPrintJob } from '../services/printQueueService';
import { ErrorModal } from '../components/ErrorModal';
import { getAllSystemMenuIds, normalizeMenuId } from '../config/menu_config';
import { getRoleTemplatePermission } from '../config/role_templates';
import { broadcastWorkNotification } from '../utils/workNotificationService';
import { issueHandoverTask, clearHandoverTasks, findActiveTasksForUser, checkAndIssuePackageResendTask } from '../utils/taskHandoverPipeline';
import { resolveSiteDetailedAddress } from '../utils/nativeLauncher';
import { emailService } from '../services/email';
import { sortCustomersByName } from '../utils/hangulSearch';

export interface AssetSaleItem {
  assetId: string;
  salePrice: number;
}

export interface AssetSalePayload {
  customerId?: string;
  buyerName: string;
  buyerBizRegNo?: string;
  buyerRepresentative?: string;
  buyerAddress?: string;
  buyerContact?: string;
  salespersonId?: string;
  disposalDate: string;
  items: AssetSaleItem[];
  saleTerms?: SaleContractTerms;
  memo?: string;
  recipientEmail?: string;
  ccEmail?: string;
  sendEmail?: boolean;
}

export interface SmartDispatchData {
  customerName: string;
  siteName: string;
  siteAddress: string;
  salespersonName?: string;
  salespersonPhone?: string;
  siteContactName: string;
  siteContactPhone: string;
  siteContactEmail: string;
  billingContactName: string;
  billingContactPhone: string;
  statementEmail: string;
  taxBillEmail: string;
  loadingTime: string;
  unloadingTime: string;
  equipments: { modelName: string, qty: number }[];
  paidOptions?: string;
  protection?: string;
  checkedSpecs?: Record<string, boolean>;
  saveOptionsToSite?: boolean; // 🌟 옵션 변경 시 현장 마스터 저장 여부 (false: 이번 출고만 1회성 적용, true: 현장 마스터 갱신)
  isSetAsCustomerDefault?: boolean;
  applyToAllSites?: boolean;
  closingDay?: string;
  paymentDay?: string;
  note: string;
  rawText?: string;
}

export interface SmartReturnData {
  contractId?: string;
  returnDate: string;
  assetIds: string[];
  loadingTime?: string;
  unloadingTime?: string;
  note?: string;
  // 정비회수 추가 필드
  repairId?: string;
  vendorId?: string;
  // 고객측 회수 담당 정보
  contactName?: string;
  contactPhone?: string;
}

interface AppContextType {
  receivables: any[];
  refreshReceivables: () => void;
  currentUser: User | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  login: (loginId: string, passwordHash: string, keepLoggedIn?: boolean) => boolean;
  logout: () => void;
  switchUser: (userId: string) => void;
  hasPermission: (menuId: string, action: 'view' | 'save') => boolean;
  showErrorModal: (message: string, title?: string) => void;
  
  // Data States
  tenants: Tenant[];
  currentTenant: Tenant;
  setCurrentTenantId: (tenantId: string) => void;
  saveTenant: (tenant: Partial<Tenant> & { id?: string }) => Promise<Tenant>;
  addTenantWorkplace: (tenantId: string, workplace: Omit<TenantWorkplace, 'id'>) => Promise<Tenant>;
  updateTenantWorkplace: (tenantId: string, workplaceId: string, workplace: Partial<TenantWorkplace>) => Promise<Tenant>;
  deleteTenantWorkplace: (tenantId: string, workplaceId: string) => Promise<Tenant>;
  addTenantYard: (tenantId: string, yard: Omit<TenantYard, 'id'>) => Promise<Tenant>;
  updateTenantYard: (tenantId: string, yardId: string, yard: Partial<TenantYard>) => Promise<Tenant>;
  deleteTenantYard: (tenantId: string, yardId: string) => Promise<Tenant>;
  setDefaultYard: (tenantId: string, yardId: string) => Promise<Tenant>;
  users: User[];
  permissions: MenuPermission[];
  customers: Customer[];
  contacts: CustomerContact[];
  sites: CustomerSite[];
  products: Product[];
  assets: Asset[];
  consumables: Consumable[];
  consumableLogs: ConsumableLog[];
  consumablePurchases: ConsumablePurchaseRequest[];
  contracts: Contract[];
  contractAssets: ContractAsset[];
  contractHistory: ContractHistory[];
  deliveries: Delivery[];
  transportCompanies: TransportCompany[];
  transportDrivers: TransportDriver[];
  transportNegotiations: TransportNegotiation[];
  subleaseNegotiations: SubleaseNegotiation[];
  billings: Billing[];
  billingDetails: BillingDetail[];
  payments: Payment[];
  paymentDepositLinks: PaymentDepositLink[];
  repairs: Repair[];
  repairConsumables: RepairConsumable[];
  todos: Todo[];
  bankTransactions: BankTransaction[];
  bankMatchingRules: BankMatchingRule[];
  bankInitialBalances: BankAccountInitialBalance[];
  saveBankInitialBalance: (bankName: string, initialBalance: number, accountNumber?: string) => Promise<void>;
  assetInOutLogs: AssetInOutLog[];
  vendors: Vendor[];
  googleConfigs: GoogleConfig[];
  cashFlowSnapshots: CashFlowSnapshot[];
  outboundInspections: OutboundInspection[];
  depreciationLogs: DepreciationLog[];
  purchaseSettlements: PurchaseSettlement[];
  purchaseSettlementItems: PurchaseSettlementItem[];
  settlementPaymentLogs: SettlementPaymentLog[];
  externalLeases: ExternalLease[];
  inspectionChecklistItems: InspectionChecklistItem[];
  equipmentManuals: EquipmentManual[];
  standardOptions: StandardOption[];
  customRoles: CustomRole[];
  rolePermissions: RolePermission[];
  saveCustomRole: (role: CustomRole) => Promise<void>;
  deleteCustomRole: (roleId: string) => Promise<void>;
  saveRolePermissions: (roleId: string, perms: { menuId: string; canView: boolean; canSave: boolean }[]) => Promise<void>;
  assignUserRole: (userId: string, customRoleId: string | null) => Promise<void>;

  annualLeaveQuotas: AnnualLeaveQuota[];
  leaveUsages: LeaveUsage[];
  overtimeRecords: OvertimeRecord[];
  payrollClosings: PayrollClosing[];

  corporateVehicles: CorporateVehicle[];
  vehicleOperationLogs: VehicleOperationLog[];
  vehicleFuelLogs: VehicleFuelLog[];

  // Mutators
  updateAnnualLeaveQuota: (userId: string, periodStart: string, periodEnd: string, grantedDays: number, memo?: string) => Promise<void>;
  addLeaveUsage: (usage: Omit<LeaveUsage, 'id' | 'createdAt'>) => Promise<void>;
  deleteLeaveUsage: (id: string) => Promise<void>;
  addOvertimeRecord: (record: Omit<OvertimeRecord, 'id' | 'createdAt'>) => Promise<void>;
  deleteOvertimeRecord: (id: string) => Promise<void>;
  setPayrollClosingStatus: (month: string, status: 'DRAFT' | 'APPROVED', approvedBy?: string) => Promise<void>;
  refreshAllData: () => void;
  fullRefreshFromServer: () => Promise<void>;
  executeMonthlyDepreciation: (depreciationYm: string, note?: string) => Promise<{ count: number; totalAmount: number }>;
  loadTablesForMenu: (menuId: string) => Promise<void>;
  updatePermissions: (updated: MenuPermission[]) => void;
  saveUser: (user: Omit<User, 'id' | 'createdAt'> & { id?: string }) => void;
  saveCustomer: (cust: Omit<Customer, 'id' | 'createdAt'> & { id?: string }) => Promise<Customer>;
  saveContact: (contact: Omit<CustomerContact, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  saveSite: (site: Omit<CustomerSite, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  deleteSite: (id: string) => Promise<void>;
  saveProduct: (prod: Omit<Product, 'id' | 'createdAt'> & { id?: string }) => void;
  saveAsset: (asset: Omit<Asset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => void;
  updateGoogleConfig: (config: GoogleConfig) => Promise<void>;
  saveCashFlowSnapshot: (snap: Omit<CashFlowSnapshot, 'id' | 'createdAt'>) => void;
  deleteCashFlowSnapshot: (snapId: string) => void;
  saveVendor: (vendor: Vendor) => Promise<void>;
  deleteVendor: (id: string) => void;
  recalculateAllVendorMetrics: () => Promise<{ updatedCount: number; totalAmount: number }>;
  saveInspectionChecklistItem: (item: Omit<InspectionChecklistItem, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  deleteInspectionChecklistItem: (id: string) => Promise<void>;
  saveEquipmentManual: (item: Omit<EquipmentManual, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  deleteEquipmentManual: (id: string) => Promise<void>;
  saveStandardOption: (option: Omit<StandardOption, 'id' | 'createdAt'> & { id?: string }) => Promise<StandardOption>;
  deleteStandardOption: (id: string) => Promise<void>;
  
  // Asset Mutators
  changeAssetStatus: (assetId: string, status: Asset['status'], extraData?: Partial<Asset>) => Promise<void>;
  acquireAsset: (assetData: Partial<Asset>) => Promise<Asset>;
  batchAcquireAssets: (assetsData: Partial<Asset>[]) => Promise<Asset[]>;
  disposeAsset: (assetId: string, disposalData: { disposalDate: string; disposalPrice: number; buyer: string; billingYm?: string }) => Promise<any>;
  executeAssetSale: (payload: AssetSalePayload) => Promise<{ success: boolean; contractId: string; billingId: string; contractNo: string }>;
  registerRentedAsset: (assetData: Partial<Asset>) => Promise<any>;
  returnRentedAsset: (assetId: string, returnDate: string, options?: { isDirectReturn?: boolean; memo?: string }) => Promise<void>;
  createVendorClaimReceivable: (data: {
    contractId?: string;
    customerId?: string;
    vendorName: string;
    assetNo: string;
    totalAmount: number;
    internalDescription: string;
    displayName?: string;
    occurredDate?: string;
  }) => Promise<void>;
  registerInboundAsset: (data: {
    assetId: string;
    returnDate: string;
    maintenanceScore?: number;
    memo?: string;
    inboundNo?: string;
    defects?: InboundDefectDetail[];
    photos?: string[];
    otherDefectText?: string;
    targetAssetStatus?: Asset['status'];
  }) => Promise<void>;
  cancelInboundAsset: (logId: string, cancelReason?: string) => Promise<void>;
  
  // Consumables Mutators
  addConsumable: (data: Omit<Consumable, 'id' | 'createdAt' | 'updatedAt' | 'stockQty'> & { stockQty?: number }) => Promise<void>;
  updateConsumable: (id: string, updates: Partial<Consumable>) => Promise<void>;
  deleteConsumable: (id: string) => Promise<void>;
  purchaseConsumable: (data: { modelName: string; qty: number; unit: string; unitPrice: number; supplier: string }) => Promise<void>;
  useConsumable: (data: { consumableId: string; quantity: number; targetAssetId: string; description: string }) => Promise<void>;
  requestConsumablePurchase: (data: { consumableId?: string; modelName: string; qty: number; unitPrice: number; requestDate: string; sellerName: string }) => Promise<void>;
  acceptConsumablePurchase: (id: string) => Promise<void>;
  completeConsumablePurchase: (id: string) => Promise<void>;
  inboundConsumablePurchase: (id: string, qty: number, statementFileUrl: string) => Promise<void>;
  clearEvidenceFileUrls: (ids: string[]) => Promise<void>;  // Storage 삭제 후 DB URL 초기화
  updateEvidenceFileUrls: (updates: { id: string; url: string }[]) => Promise<void>; // Storage 삭제 후 Drive URL로 교체
  
  // AS 기사 차량별 이동재고 (Van Stock)
  mechanicConsumableStocks: MechanicConsumableStock[];
  transferConsumableToMechanic: (mechanicId: string, consumableId: string, quantity: number, memo?: string) => Promise<void>;
  returnConsumableToHq: (mechanicId: string, consumableId: string, quantity: number, memo?: string, isDefective?: boolean, disposition?: 'REBUILD' | 'SCRAP' | 'VENDOR_WARRANTY') => Promise<void>;
  transferConsumableBetweenMechanics: (fromMechanicId: string, toMechanicId: string, consumableId: string, quantity: number, memo?: string) => Promise<void>;

  // 재고실사(Stocktaking Audit) & 고품 관리
  stocktakingAudits: StocktakingAudit[];
  stocktakingAuditItems: StocktakingAuditItem[];
  collectedParts: CollectedPart[];
  createStocktakingAudit: (targetType: 'HQ' | 'VEHICLE', mechanicId?: string, memo?: string) => Promise<StocktakingAudit>;
  updateStocktakingItem: (auditId: string, itemId: string, actualQty: number, diffReason?: StocktakingAuditItem['diffReason'], note?: string) => Promise<void>;
  confirmStocktakingAudit: (auditId: string) => Promise<void>;
  cancelStocktakingAudit: (auditId: string) => Promise<void>;
  processCollectedPart: (partId: string, actionStatus: 'IN_PROCESS' | 'COMPLETED', actionMemo?: string) => Promise<void>;

  // 현장 AS 관리
  fieldAsTickets: FieldAsTicket[];
  createFieldAsTicket: (data: Partial<FieldAsTicket>) => Promise<FieldAsTicket>;
  updateFieldAsTicketStatus: (ticketId: string, status: FieldAsTicket['status'], extra?: Partial<FieldAsTicket>) => Promise<void>;
  completeFieldAsTicket: (ticketId: string, completionData: {
    mechanicId: string;
    actionTaken: string;
    resolutionType: FieldAsTicket['resolutionType'];
    partsUsed?: FieldAsPartUsed[];
    collectedParts?: FieldAsCollectedPart[];
    billableType: 'FREE' | 'BILLABLE';
    billableAmount: number;
    beforeImage?: string;
    afterImage?: string;
    customerSignature?: string;
    customerConfirmName?: string;
    revisitDate?: string;
    revisitReason?: string;
    exchangeSuggested?: boolean;
    inspectionItemId?: string;
    inspectionItemCode?: string;
    degradationScore?: number;
    durationMinutes?: number;
    spentManHours?: number;
  }) => Promise<void>;
  createRevisitAsTicket: (parentTicketId: string, revisitDate: string, revisitReason: string, mechanicId?: string) => Promise<FieldAsTicket>;
  importBandAsHistory: (records: any[]) => Promise<number>;
  logFieldAsTimelineEvent: (ticketId: string, eventType: 'CALL_MADE' | 'TRANSIT_START' | 'ARRIVED' | 'COMPLETED', detail?: string) => Promise<void>;
  
  // Contract Mutators
  createContract: (contractData: Omit<Contract, 'id' | 'createdAt' | 'updatedAt' | 'contractNo'>, assetsList: { assetId?: string; expectedModel?: string; monthlyRentalFee: number; dailyRentalFee: number }[]) => Promise<void>;
  extendContract: (contractId: string, newEndDate: string, description: string) => Promise<void> | void;
  shortenContract: (contractId: string, newEndDate: string, description: string) => Promise<void> | void;
  succeedContract: (contractId: string, successorCustomerId: string, successorContactId: string, successorSiteId: string, successionDate: string, description: string) => Promise<void> | void;
  exchangeAsset: (contractId: string, oldAssetId: string, newAssetId: string, exchangeDate: string) => Promise<void> | void;
  
  // 장비 할당 및 출고전 교체 / 할당 취소
  assignAssetToContract: (contractAssetId: string, assetId: string) => Promise<void>;
  batchAssignAssetsToContract: (pairs: { contractAssetId: string; assetId: string }[]) => Promise<void>;
  unassignAssetFromContract: (contractAssetId: string) => Promise<void>;
  batchUnassignAssetsFromContract: (contractAssetIds: string[]) => Promise<void>;
  exchangeOutboundAsset: (contractAssetId: string, oldAssetId: string, newAssetId: string, reason?: string, markOldAsRepairing?: boolean, customPenaltyScore?: number) => Promise<void>;
  saveSmartDispatch: (data: SmartDispatchData, autoRegister: boolean, onProgress?: (log: string, percent: number) => void) => Promise<{ success: boolean; requiresConfirm?: boolean; missingFields?: string[]; errorMessage?: string; contractId?: string; contractNo?: string }>;
  saveSmartReturn: (data: SmartReturnData) => Promise<any>;
  
  // Todos & Executive Directives
  completeTodo: (todoId: string) => void;
  issueExecutiveDirective: (params: {
    targetType: 'USER' | 'DEPT';
    targetUserId?: string;
    targetDept?: string;
    title: string;
    content: string;
    priority?: 'URGENT' | 'HIGH' | 'NORMAL';
    dueDate?: string;
    actionUrl?: string;
  }) => Promise<Todo>;
  resolveExecutiveDirective: (todoId: string, resolutionNote: string) => Promise<void>;
  cancelExecutiveDirective: (todoId: string) => Promise<void>;
  
  // Billings
  generateBillingsForMonth: (billingYm: string, billingDate: string) => Promise<void>;
  getDueContractsForBilling: (targetDate?: string) => { contract: Contract; customer: Customer; site?: CustomerSite; billingDay: number; dueReason: string }[];
  generateDueBillings: (targetDate?: string, targetYm?: string) => Promise<{ successCount: number; skippedContracts: { contractId: string; customerId: string; reason: string }[] }>;
  generateBillingForSingleContract: (contractId: string, billingYm: string, billingDate: string) => Promise<string | null>;
  regenerateBilling: (billingId: string, customDetails?: Omit<BillingDetail, 'id' | 'billingId' | 'createdAt'>[], options?: { billingYm?: string; billingDate?: string; memo?: string }) => Promise<string>;
  approveBilling: (billingId: string) => Promise<void>; // UNPAID → REQUESTED (거래명세서 발송)
  cancelBilling: (billingId: string, refund?: boolean) => Promise<void>; // 환불=true, 비환불=false(기본)
  addReceivable: (data: Omit<Receivable, 'id' | 'createdAt' | 'updatedAt'>) => string;
  generateStandaloneBillingForReceivable: (receivableId: string, reason: string) => Promise<string>;
  linkReceivableToBilling: (billingId: string, receivableId: string, amount: number, displayName?: string) => Promise<void>;
  receivePayment: (billingId: string, data: {
    paymentDate: string;
    amount: number;
    method: string;
    memo: string;
    depositLinks?: { bankTransactionId: string; usedAmount: number }[]; // 통장입금 연동 (N건)
  }) => Promise<void> | void;
  cancelPayment: (paymentId: string) => Promise<void>;  // 수납 취소 + PDL 연쇄 삭제 + Billing 롤백 + 선수금 환원
  cancelAllPaymentsForBilling: (billingId: string) => Promise<void>; // 청구서 전체 수납 일괄 취소 및 롤백
  saveBankDeposit: (data: Omit<BankTransaction, 'id' | 'createdAt' | 'withdrawAmount'>) => void;  // 통장입금 등록/수정
  deleteBankDeposit: (txId: string) => void;  // 통장입금 삭제 (연결 수납 없을 때만)
  uploadBankTransactions: (txs: Omit<BankTransaction, 'id' | 'createdAt'>[]) => void;
  matchTransactionManual: (
    txId: string,
    billingId: string,
    learnRule: boolean,
    options?: {
      matchingMode?: 'PINPOINT' | 'CASCADE' | 'MULTI';
      allocations?: { billingId: string; amount: number; feeAdjustment?: number }[];
      feeAdjustment?: number;
    }
  ) => Promise<void> | void;
  batchAutoMatchTransactions: () => Promise<number>;
  unmatchTransaction: (txId: string) => Promise<void> | void;
  saveMatchingRule: (senderName: string, customerId: string) => void;
  deleteMatchingRule: (ruleId: string) => void;
  
  // Deliveries
  dispatchDelivery: (deliveryId: string, dispatchData: { scheduledDate: string; transportCompany: string; vehicleType: string; vehicleNo: string; driverName: string; driverContact: string; deliveryCost: number; vehiclesJson?: string }) => void;
  settleDeliveryCost: (deliveryId: string, deliveryCostConfirmed: number, vehiclesJson?: string) => void;
  completeDelivery: (deliveryId: string) => Promise<void>;
  completeInboundDelivery: (deliveryId: string, actualReturnDate: string, reviews: { assetId: string; status: 'AVAILABLE' | 'REPAIRING'; maintenanceScore: number; memo: string; faultImageUrl?: string }[]) => void;
  
  // Repairs
  registerRepair: (repairData: Partial<Repair>, usedConsumables: { consumableId: string; quantity: number }[]) => void;
  updateRepairStatus: (repairId: string, status: Repair['status'], unresolvedReason?: string, nextAction?: Repair['nextAction'], targetAssetStatus?: Asset['status']) => Promise<void>;
  
  // Transport Master
  saveTransportDataOnFly: (companyName: string, driverName: string, contact: string, vehicleNo: string, vehicleType: string) => void;

  // Purchase Settlement Mutators
  generateMonthlyPurchaseSettlements: (ym: string) => Promise<{ transport: number; consumable: number; lease: number; repair: number }>;
  confirmPurchaseSettlement: (id: string) => Promise<void>;
  recordPurchaseSettlementPayment: (id: string, data: { paidAmount: number; paymentDate: string; paymentMethod: string; bankAccount?: string; bankTransactionId?: string; memo?: string }) => Promise<void>;
  savePurchaseSettlement: (settlement: Partial<PurchaseSettlement>) => Promise<void>;
  convertReconciledDeliveriesToSettlement: (settlementYm: string, transportCompanyId?: string) => Promise<number>;

  // Depreciation Execution Mutators
  cancelMonthlyDepreciation: (depreciationYm: string) => Promise<void>;

  // Repair to Billing Linkage & Waiver
  linkRepairToBilling: (repairId: string, billingId: string) => Promise<void>;
  unlinkRepairFromBilling: (repairId: string) => Promise<void>;
  waiveRepairBilling: (repairId: string, waivedAmount: number, waivedReason: string, waivedBy: string) => Promise<void>;
  cancelRepairWaiver: (repairId: string) => Promise<void>;

  // Delivery to Billing Linkage & Waiver
  linkDeliveryToBilling: (deliveryId: string, billingId: string) => Promise<void>;
  unlinkDeliveryFromBilling: (deliveryId: string) => Promise<void>;
  waiveDeliveryBilling: (deliveryId: string, waivedAmount: number, waivedReason: string, waivedBy: string) => Promise<void>;
  cancelDeliveryWaiver: (deliveryId: string) => Promise<void>;

  // Prepaid Balance Management
  prepaidTransactions: PrepaidTransaction[];
  chargePrepaidBalance: (customerId: string, amount: number, memo?: string) => Promise<void>;
  applyPrepaidBalanceForBilling: (billingId: string, amount: number, memo?: string) => Promise<void>;
  refundPrepaidBalance: (customerId: string, amount: number, memo?: string) => Promise<void>;

  // Delinquency Management
  delinquencyActionLogs: DelinquencyActionLog[];
  legalNoticeLogs: LegalNoticeLog[];
  legalNoticeTemplates: LegalNoticeTemplate[];
  saveLegalNoticeLog: (log: Omit<LegalNoticeLog, 'id' | 'createdAt'>) => Promise<LegalNoticeLog>;
  saveLegalNoticeTemplate: (tpl: Omit<LegalNoticeTemplate, 'id' | 'updatedAt'> & { id?: string }) => Promise<void>;

  saveDelinquencyAction: (action: Omit<DelinquencyActionLog, 'id' | 'createdAt'>) => Promise<void>;
  updateDelinquencyActionPromise: (actionId: string, status: 'PENDING' | 'KEPT' | 'BROKEN') => Promise<void>;

  // Corporate Fleet & Vehicle Operation/Fuel Logs
  registerCorporateVehicle: (vehicle: Omit<CorporateVehicle, 'id' | 'createdAt' | 'updatedAt'>) => Promise<CorporateVehicle>;
  updateCorporateVehicle: (id: string, updates: Partial<CorporateVehicle>) => Promise<void>;
  deleteCorporateVehicle: (id: string) => Promise<void>;
  registerVehicleOperationLog: (log: Omit<VehicleOperationLog, 'id' | 'createdAt' | 'updatedAt'>) => Promise<VehicleOperationLog>;
  updateVehicleOperationLog: (id: string, updates: Partial<VehicleOperationLog>) => Promise<void>;
  deleteVehicleOperationLog: (id: string) => Promise<void>;
  registerVehicleFuelLog: (fuelLog: Omit<VehicleFuelLog, 'id' | 'createdAt' | 'updatedAt'>) => Promise<VehicleFuelLog>;
  deleteVehicleFuelLog: (id: string) => Promise<void>;

  // Distributed Print Queue & Stations
  printStations: PrintStation[];
  printQueue: PrintQueueItem[];
  enqueuePrintJob: (params: {
    stationId?: string;
    docType: 'DISPATCH_ORDER' | 'RETURN_ORDER';
    docNo?: string;
    title: string;
    documentHtml: string;
    requestedById?: string;
    requestedByName?: string;
  }) => Promise<PrintQueueItem>;
  registerPrintStation: (station: {
    id?: string;
    stationName: string;
    localPrinterName: string;
    machineName?: string;
    docTypeDefault?: 'DISPATCH_ORDER' | 'RETURN_ORDER' | 'ALL';
    description?: string;
  }) => Promise<PrintStation>;
  deletePrintStation: (id: string) => Promise<void>;
  retryPrintJob: (id: string) => Promise<void>;
  cancelPrintJob: (id: string) => Promise<void>;

  // Navigation states (cross-page routing)
  activeTab: string;
  setActiveTab: (tab: string) => void;
  navigationPayload: any;
  setNavigationPayload: (payload: any) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // React state of database tables
  const [tenants, setTenants] = useState<Tenant[]>(() => db.tenants || []);
  const [currentTenantId, setCurrentTenantIdState] = useState<string>(() => {
    return (typeof window !== 'undefined' ? localStorage.getItem('erp_current_tenant_id') : null) || db.currentTenant?.id || 'tenant-1';
  });

  const currentTenant = (tenants && tenants.length > 0 ? (tenants.find(t => t.id === currentTenantId || t.tenantCode === currentTenantId) || tenants.find(t => t.isDefault) || tenants[0]) : null) || db.currentTenant;

  const setCurrentTenantId = (id: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('erp_current_tenant_id', id);
    }
    setCurrentTenantIdState(id);
  };

  const saveTenant = async (tenant: Partial<Tenant> & { id?: string }): Promise<Tenant> => {
    let saved: Tenant;
    if (tenant.id) {
      saved = db.updateRow<Tenant>('tenants', tenant.id, tenant as any) as Tenant;
    } else {
      saved = db.insertRow<Tenant>('tenants', tenant as any) as Tenant;
    }
    await db.awaitPendingWrites();
    setTenants([...db.tenants]);
    return saved;
  };

  const addTenantWorkplace = async (tenantId: string, workplaceData: Omit<TenantWorkplace, 'id'>): Promise<Tenant> => {
    const targetTenant = tenants.find(t => t.id === tenantId) || currentTenant;
    const newId = `wp-${Date.now()}`;
    const newWorkplace: TenantWorkplace = {
      ...workplaceData,
      id: newId,
      createdAt: new Date().toISOString(),
    };
    const updatedWorkplaces = [...(targetTenant.workplaces || []), newWorkplace];
    return saveTenant({ id: targetTenant.id, workplaces: updatedWorkplaces });
  };

  const updateTenantWorkplace = async (tenantId: string, workplaceId: string, updates: Partial<TenantWorkplace>): Promise<Tenant> => {
    const targetTenant = tenants.find(t => t.id === tenantId) || currentTenant;
    const updatedWorkplaces = (targetTenant.workplaces || []).map(wp => 
      wp.id === workplaceId ? { ...wp, ...updates, updatedAt: new Date().toISOString() } : wp
    );
    return saveTenant({ id: targetTenant.id, workplaces: updatedWorkplaces });
  };

  const deleteTenantWorkplace = async (tenantId: string, workplaceId: string): Promise<Tenant> => {
    const targetTenant = tenants.find(t => t.id === tenantId) || currentTenant;
    const updatedWorkplaces = (targetTenant.workplaces || []).filter(wp => wp.id !== workplaceId);
    return saveTenant({ id: targetTenant.id, workplaces: updatedWorkplaces });
  };

  const addTenantYard = async (tenantId: string, yardData: Omit<TenantYard, 'id'>): Promise<Tenant> => {
    const targetTenant = tenants.find(t => t.id === tenantId) || currentTenant;
    const newId = `yard-${Date.now()}`;
    const newYard: TenantYard = {
      ...yardData,
      id: newId,
      createdAt: new Date().toISOString(),
    };
    let updatedYards = [...(targetTenant.yards || [])];
    if (newYard.isDefault) {
      updatedYards = updatedYards.map(y => ({ ...y, isDefault: false }));
    }
    updatedYards.push(newYard);
    return saveTenant({ 
      id: targetTenant.id, 
      yards: updatedYards,
      mainYardAddress: newYard.isDefault ? newYard.name : targetTenant.mainYardAddress 
    });
  };

  const updateTenantYard = async (tenantId: string, yardId: string, updates: Partial<TenantYard>): Promise<Tenant> => {
    const targetTenant = tenants.find(t => t.id === tenantId) || currentTenant;
    let updatedYards = (targetTenant.yards || []).map(y => {
      if (y.id === yardId) {
        return { ...y, ...updates, updatedAt: new Date().toISOString() };
      }
      if (updates.isDefault) {
        return { ...y, isDefault: false };
      }
      return y;
    });
    const defaultYard = updatedYards.find(y => y.isDefault);
    return saveTenant({ 
      id: targetTenant.id, 
      yards: updatedYards,
      mainYardAddress: defaultYard ? defaultYard.name : targetTenant.mainYardAddress 
    });
  };

  const deleteTenantYard = async (tenantId: string, yardId: string): Promise<Tenant> => {
    const targetTenant = tenants.find(t => t.id === tenantId) || currentTenant;
    const updatedYards = (targetTenant.yards || []).filter(y => y.id !== yardId);
    return saveTenant({ id: targetTenant.id, yards: updatedYards });
  };

  const setDefaultYard = async (tenantId: string, yardId: string): Promise<Tenant> => {
    return updateTenantYard(tenantId, yardId, { isDefault: true });
  };

  const [users, setUsers] = useState<User[]>([]);
  const [permissions, setPermissions] = useState<MenuPermission[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contacts, setContacts] = useState<CustomerContact[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [consumables, setConsumables] = useState<Consumable[]>([]);
  const [consumableLogs, setConsumableLogs] = useState<ConsumableLog[]>([]);
  const [consumablePurchases, setConsumablePurchases] = useState<ConsumablePurchaseRequest[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractAssets, setContractAssets] = useState<ContractAsset[]>([]);
  const [contractHistory, setContractHistory] = useState<ContractHistory[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [transportCompanies, setTransportCompanies] = useState<TransportCompany[]>([]);
  const [transportDrivers, setTransportDrivers] = useState<TransportDriver[]>([]);
  const [transportNegotiations, setTransportNegotiations] = useState<TransportNegotiation[]>([]);
  const [subleaseNegotiations, setSubleaseNegotiations] = useState<SubleaseNegotiation[]>([]);
  const [billings, setBillings] = useState<Billing[]>([]);
  const [billingDetails, setBillingDetails] = useState<BillingDetail[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentDepositLinks, setPaymentDepositLinks] = useState<PaymentDepositLink[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [repairConsumables, setRepairConsumables] = useState<RepairConsumable[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [bankMatchingRules, setBankMatchingRules] = useState<BankMatchingRule[]>([]);
  const [bankInitialBalances, setBankInitialBalances] = useState<BankAccountInitialBalance[]>([]);
  const [assetInOutLogs, setAssetInOutLogs] = useState<AssetInOutLog[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [googleConfigs, setGoogleConfigs] = useState<GoogleConfig[]>([]);
  const [cashFlowSnapshots, setCashFlowSnapshots] = useState<CashFlowSnapshot[]>([]);
  const [outboundInspections, setOutboundInspections] = useState<OutboundInspection[]>([]);
  const [depreciationLogs, setDepreciationLogs] = useState<DepreciationLog[]>([]);
  const [purchaseSettlements, setPurchaseSettlements] = useState<PurchaseSettlement[]>([]);
  const [purchaseSettlementItems, setPurchaseSettlementItems] = useState<PurchaseSettlementItem[]>([]);
  const [externalLeases, setExternalLeases] = useState<ExternalLease[]>([]);
  const [inspectionChecklistItems, setInspectionChecklistItems] = useState<InspectionChecklistItem[]>([]);
  const [equipmentManuals, setEquipmentManuals] = useState<EquipmentManual[]>([]);
  const [standardOptions, setStandardOptions] = useState<StandardOption[]>([]);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [annualLeaveQuotas, setAnnualLeaveQuotas] = useState<AnnualLeaveQuota[]>([]);
  const [leaveUsages, setLeaveUsages] = useState<LeaveUsage[]>([]);
  const [overtimeRecords, setOvertimeRecords] = useState<OvertimeRecord[]>([]);
  const [payrollClosings, setPayrollClosings] = useState<PayrollClosing[]>([]);
  const [prepaidTransactions, setPrepaidTransactions] = useState<PrepaidTransaction[]>([]);
  const [delinquencyActionLogs, setDelinquencyActionLogs] = useState<DelinquencyActionLog[]>([]);
  const [legalNoticeLogs, setLegalNoticeLogs] = useState<LegalNoticeLog[]>([]);
  const [legalNoticeTemplates, setLegalNoticeTemplates] = useState<LegalNoticeTemplate[]>([]);
  const [corporateVehicles, setCorporateVehicles] = useState<CorporateVehicle[]>([]);
  const [vehicleOperationLogs, setVehicleOperationLogs] = useState<VehicleOperationLog[]>([]);
  const [vehicleFuelLogs, setVehicleFuelLogs] = useState<VehicleFuelLog[]>([]);
  const [stocktakingAudits, setStocktakingAudits] = useState<StocktakingAudit[]>([]);
  const [stocktakingAuditItems, setStocktakingAuditItems] = useState<StocktakingAuditItem[]>([]);
  const [collectedParts, setCollectedParts] = useState<CollectedPart[]>([]);
  const [mechanicConsumableStocks, setMechanicConsumableStocks] = useState<MechanicConsumableStock[]>([]);
  const [printStations, setPrintStations] = useState<PrintStation[]>([]);
  const [printQueue, setPrintQueue] = useState<PrintQueueItem[]>([]);


  // Navigation / Routing states
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [navigationPayload, setNavigationPayload] = useState<any>(null);

  // 글로벌 커스텀 에러 모달 상태
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean; title?: string; message: string }>({
    isOpen: false,
    title: '시스템 오류 발생',
    message: ''
  });

  const showErrorModal = (message: string, title: string = '시스템 오류 발생') => {
    setErrorModal({
      isOpen: true,
      title,
      message
    });
  };

  // ─────────────────────────────────────────────────────────
  // 로컬 db 인메모리 스토어 → React state 즉시 동기화 (Supabase pull 없음 — 저장 후 즉각 화면 반영용)
  const refreshAllData = () => {
    // 💡 헌장 1.2 & 5.2 준수: DB 상에 존재하는 물리적 중복 청구 상세 레코드 완벽 소탕 & 원격 DB(Supabase) 동기 삭제
    const seen = new Set<string>();
    const duplicateIds: string[] = [];
    db.billingDetails.forEach(bd => {
      const key = `${bd.billingId}_${bd.contractAssetId || ''}_${bd.itemName}_${bd.amount}_${bd.description || ''}`;
      if (seen.has(key)) {
        duplicateIds.push(bd.id);
      } else {
        seen.add(key);
      }
    });
    if (duplicateIds.length > 0) {
      duplicateIds.forEach(id => db.deleteRow('billingDetails', id));
      // 원격 DB에서도 중복 행 물리 삭제 대기
      db.awaitPendingWrites().catch(err => console.error("BillingDetails cleanup error:", err));
    }

    // 💡 헌장 1.2 & 5.2 준수: 계약/배차가 존재하지 않는 고아 출고검수의뢰(outboundInspections) 자동 소탕 & DB 동기 삭제
    if (db.contracts.length > 0) {
      const validContractIds = new Set(db.contracts.map(c => c.id));
      const validDeliveryIds = new Set(db.deliveries.map(d => d.id));
      const orphanInspections = db.outboundInspections.filter(
        i => (!i.contractId || !validContractIds.has(i.contractId)) &&
             (!i.deliveryId || !validDeliveryIds.has(i.deliveryId))
      );
      if (orphanInspections.length > 0) {
        orphanInspections.forEach(i => db.deleteRow('outboundInspections', i.id));
        db.awaitPendingWrites().catch(err => console.error("Orphan inspections cleanup error:", err));
      }
    }

    // 진짜 개발자(admin, sys-admin) 계정만 '개발자'로 정규화 (사장/부사장 등 최고관리자 성명 보존)
    db.users.forEach(u => {
      if (u.loginId === 'admin' || u.id === 'sys-admin') {
        u.name = '개발자';
      }
    });

    setTenants([...db.tenants]);
    setUsers([...db.users]);
    setPermissions([...db.permissions]);
    setCustomers(sortCustomersByName([...db.customers]));
    setContacts([...db.contacts]);
    setSites([...db.sites]);
    setProducts([...db.products]);
    setAssets([...db.assets]);
    setConsumables([...db.consumables]);
    setConsumableLogs([...db.consumableLogs]);
    setConsumablePurchases([...db.consumablePurchases]);
    setContracts([...db.contracts]);
    setContractAssets([...db.contractAssets]);
    setContractHistory([...db.contractHistory]);
    setDeliveries([...db.deliveries]);
    setTransportCompanies([...db.transportCompanies]);
    setTransportDrivers([...db.transportDrivers]);
    setTransportNegotiations([...db.transportNegotiations]);
    setSubleaseNegotiations([...db.subleaseNegotiations]);
    setBillings([...db.billings]);
    setBillingDetails([...db.billingDetails]);
    setPayments([...db.payments]);
    setPaymentDepositLinks([...db.paymentDepositLinks]);
    setRepairs([...db.repairs]);
    setRepairConsumables([...db.repairConsumables]);
    setTodos([...db.todos]);
    setBankTransactions([...db.bankTransactions]);
    setBankMatchingRules([...db.bankMatchingRules]);
    setBankInitialBalances([...db.bankInitialBalances]);
    setAssetInOutLogs([...db.assetInOutLogs]);
    setVendors([...db.vendors]);
    setGoogleConfigs([...db.googleConfigs]);
    setCashFlowSnapshots([...db.cashFlowSnapshots]);
    setOutboundInspections([...db.outboundInspections]);
    setDepreciationLogs([...db.depreciationLogs]);
    setPurchaseSettlements([...db.purchaseSettlements]);
    setPurchaseSettlementItems([...db.purchaseSettlementItems]);
    setExternalLeases([...db.externalLeases]);
    setInspectionChecklistItems([...db.inspectionChecklistItems]);
    setEquipmentManuals([...db.equipmentManuals]);
    setStandardOptions([...db.standardOptions]);
    setCustomRoles([...db.customRoles]);
    setRolePermissions([...db.rolePermissions]);
    setAnnualLeaveQuotas([...db.annualLeaveQuotas]);
    setLeaveUsages([...db.leaveUsages]);
    setOvertimeRecords([...db.overtimeRecords]);
    setPayrollClosings([...db.payrollClosings]);
    setPrepaidTransactions([...db.prepaidTransactions]);
    setDelinquencyActionLogs([...db.delinquencyActionLogs]);
    setLegalNoticeLogs([...db.legalNoticeLogs]);
    setLegalNoticeTemplates([...db.legalNoticeTemplates]);
    setCorporateVehicles([...db.corporateVehicles]);
    setVehicleOperationLogs([...db.vehicleOperationLogs]);
    setVehicleFuelLogs([...db.vehicleFuelLogs]);
    setStocktakingAudits([...db.stocktakingAudits]);
    setStocktakingAuditItems([...db.stocktakingAuditItems]);
    setCollectedParts([...db.collectedParts]);
    setMechanicConsumableStocks([...db.mechanicConsumableStocks]);
    setPrintStations([...db.printStations]);
    setPrintQueue([...db.printQueue]);

    setCurrentUser(prev => {
      if (prev && (prev.loginId === 'admin' || prev.id === 'sys-admin')) {
        return { ...prev, name: '개발자' };
      }
      return prev;
    });
  };

  // 전체 테이블 Supabase pull 후 state 동기화 (초기 로딩 전용)
  const fullRefreshFromServer = async () => {
    if (db.isSupabaseConnected()) {
      try {
        await db.pullFromSupabase();
      } catch (err) {
        console.error("Failed to sync from Supabase:", err);
      }
    }
    refreshAllData();
  };

  // 메뉴별 관련 테이블만 Supabase pull (메뉴 전환 시 호출 — 최신 데이터 보장)
  const MENU_TABLE_MAP: Record<string, string[]> = {
    'dashboard':            ['deliveries', 'contracts', 'billings', 'todos', 'assets'],
    'delivery':             ['deliveries', 'transportCompanies', 'transportDrivers', 'contracts', 'assets', 'printStations', 'printQueue'],
    'transport_master':     ['transportCompanies', 'transportDrivers'],
    'field_as':             ['repairs', 'assets', 'users', 'consumables', 'mechanicConsumableStocks', 'customers', 'sites', 'contracts'],
    'smart_as_request':     ['repairs', 'customers', 'sites', 'contracts', 'contractAssets', 'assets'],
    'repair':               ['repairs', 'assets', 'consumables', 'repairConsumables', 'mechanicConsumableStocks', 'vendors'],
    'contract':             ['contracts', 'contractAssets', 'contractHistory', 'customers', 'assets'],
    'billing':              ['billings', 'billingDetails', 'payments', 'paymentDepositLinks', 'bankTransactions', 'contracts', 'customers'],
    'customer':             ['customers', 'contacts', 'sites'],
    'product':              ['products'],
    'asset':                ['assets', 'products', 'vendors'],
    'acquisition_disposal': ['assets', 'products', 'vendors'],
    'rent_asset':           ['assets', 'vendors'],
    'consumable':           ['consumables', 'consumableLogs', 'consumablePurchases', 'vendors', 'mechanicConsumableStocks', 'stocktakingAudits', 'stocktakingAuditItems', 'collectedParts'],
    'consumable_purchase':  ['consumables', 'consumablePurchases', 'vendors'],
    'consumable_inout':     ['consumables', 'consumableLogs', 'consumablePurchases', 'assets', 'mechanicConsumableStocks'],
    'consumable_stock':     ['consumables', 'consumableLogs', 'mechanicConsumableStocks', 'stocktakingAudits', 'stocktakingAuditItems', 'collectedParts'],
    'smart_dispatch':       ['deliveries', 'contracts', 'assets', 'transportCompanies', 'transportDrivers', 'printStations', 'printQueue'],
    'smart_dispatch4':      ['customers', 'sites', 'contacts', 'contracts', 'deliveries', 'assets', 'products'],
    'smart_return':         ['deliveries', 'contracts', 'assets', 'transportCompanies', 'transportDrivers', 'printStations', 'printQueue'],
    'asset_inout_history':  ['assetInOutLogs', 'assets', 'customers'],
    'dispatch_assign':      ['contracts', 'contractAssets', 'assets', 'outboundInspections', 'customers', 'contractHistory'],
    'outbound_inspections': ['outboundInspections', 'contracts', 'contractAssets', 'assets', 'customers', 'sites', 'deliveries'],
    'bank_matching':        ['bankTransactions', 'bankMatchingRules', 'billings', 'customers'],
    'vendors':              ['vendors'],
    'organization':         ['users', 'departments'],
    'permission':           ['users', 'permissions', 'departments'],
    'payroll':              ['users', 'departments'],
    'corporate_card':       ['vendors', 'billings'],
    'cash_flow':            ['billings', 'payments', 'contracts', 'assets'],
    'delinquency':          ['billings', 'customers', 'contracts'],
    'google_config':        ['googleConfigs'],
    'depreciation_execution': ['depreciationLogs', 'assets'],
    'leave_application':    ['users', 'annualLeaveQuotas', 'leaveUsages'],
    'leave_management':     ['users', 'annualLeaveQuotas', 'leaveUsages', 'overtimeRecords', 'departments'],
    'ot_management':        ['users', 'overtimeRecords', 'departments'],
    'leave_ot':             ['users', 'annualLeaveQuotas', 'leaveUsages', 'overtimeRecords'],
    'vehicle_log':          ['corporateVehicles', 'vehicleOperationLogs', 'vehicleFuelLogs', 'users'],
    'regular_reports':      ['contracts', 'contractAssets', 'deliveries', 'assets', 'repairs', 'purchaseSettlements', 'purchaseSettlementItems', 'billings', 'billingDetails', 'bankTransactions', 'customers'],
    'initial_db_upload':    ['contracts', 'contractAssets', 'customers', 'assets', 'sites', 'billings', 'billingDetails'],
    'print_queue_monitor':  ['printStations', 'printQueue'],
    'privacy_audit':        ['privacyAccessLogs', 'users', 'departments'],
  };

  const loadTablesForMenu = async (menuId: string) => {
    if (!db.isSupabaseConnected()) return;
    const keys = MENU_TABLE_MAP[menuId];
    if (!keys || keys.length === 0) return;
    try {
      await Promise.all(keys.map(key => db.pullTableFromSupabase(key)));
      refreshAllData();
    } catch (err) {
      console.warn('loadTablesForMenu error:', err);
    }
  };


  useEffect(() => {
    // Seed 계약 데이터 초기화는 개발 환경(localhost)에서만 실행
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      if (!localStorage.getItem('seed_v1_8_dummy_contracts_v2')) {
        localStorage.removeItem('erp_contracts');
        localStorage.removeItem('erp_contractAssets');
        localStorage.setItem('seed_v1_8_dummy_contracts_v2', 'true');
      }
    }


    // 안전한 Google Config 마이그레이션 (기존 정보 보존 및 신규 컬럼 주입)
    const existingConfigsStr = localStorage.getItem('erp_googleConfigs');
    if (existingConfigsStr) {
      try {
        const configs = JSON.parse(existingConfigsStr);
        if (Array.isArray(configs) && configs.length > 0) {
          let updated = false;
          const defaultTemplate: Record<string, any> = {
            isDevMode: false,
            quotationTemplateUrl: 'templates/렌탈견적서_양식.html',
            contractTemplateUrl: 'templates/고소작업대_임대차계약서_양식.html',
            safetyInspectionTemplateUrl: 'templates/고소작업대_안전점검결과서_양식.html',
            preDeliveryChecklistTemplateUrl: 'templates/반입전_CHECK_LIST_양식.html',
            bizRegCertUrl: '',
            bankbookCopyUrl: '',
            transactionStatementTemplateUrl: 'templates/거래명세서_양식.html',
            r2AccountId: '35014a2514680107d74e1e68d96e6c32',
            r2BucketName: 'kiyeun-storage',
            r2AccessKeyId: '03cdb7560d37242de608a5db2a976030',
            r2SecretAccessKey: 'b2407ab4532e02317860bc3d63226fb7bc232e88083b150c15023906ed141986',
            r2PublicDomain: 'https://pub-a2fd3c2ae0cc450b8ebe34baf1b051e1.r2.dev'
          };

          const mergedConfigs = configs.map(cfg => {
            const newCfg = { ...cfg };
            for (const [key, value] of Object.entries(defaultTemplate)) {
              if (newCfg[key] === undefined) {
                newCfg[key] = value;
                updated = true;
              }
            }
            return newCfg;
          });

          if (updated) {
            localStorage.setItem('erp_googleConfigs', JSON.stringify(mergedConfigs));
          }
        }
      } catch (e) {
        console.error('Failed to migrate google config safely', e);
      }
    }
    localStorage.setItem('seed_v2_2_google_config_v2', 'true');

    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
    
    const savedUser = sessionStorage.getItem('user');
    const autoUser = localStorage.getItem('auto_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed.loginId === 'admin' && (parsed.name === '최고관리자' || !parsed.name)) {
          parsed.name = '개발자';
          sessionStorage.setItem('user', JSON.stringify(parsed));
        }
        setCurrentUser(parsed);
      } catch (e) {
        setCurrentUser(null);
      }
    } else if (autoUser) {
      try {
        const parsed = JSON.parse(autoUser);
        if (parsed.loginId === 'admin' && (parsed.name === '최고관리자' || !parsed.name)) {
          parsed.name = '개발자';
          localStorage.setItem('auto_user', JSON.stringify(parsed));
        }
        setCurrentUser(parsed);
      } catch (e) {
        setCurrentUser(null);
      }
    }
    
    // 초기 로딩: 전체 28개 테이블 Supabase pull (앱 최초 진입 1회만)
    fullRefreshFromServer();
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    localStorage.setItem('theme', nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
  };

  const login = (loginId: string, passwordHash: string, keepLoggedIn?: boolean): boolean => {
    if (loginId === 'admin' && passwordHash === 'admin123') {
      const fallbackAdmin: User = { 
        id: 'sys-admin', loginId: 'admin', passwordHash: 'admin123', 
        name: '개발자', department: '시스템', departmentId: '', role: 'ADMIN', createdAt: new Date().toISOString() 
      };
      setCurrentUser(fallbackAdmin);
      sessionStorage.setItem('user', JSON.stringify(fallbackAdmin));
      if (keepLoggedIn) {
        localStorage.setItem('auto_user', JSON.stringify(fallbackAdmin));
      } else {
        localStorage.removeItem('auto_user');
      }
      logPrivacyAccess('LOGIN', 'login', '개발자 최고관리자 로그인 성공', {
        userId: fallbackAdmin.loginId,
        userName: fallbackAdmin.name
      }).catch(console.error);
      return true;
    }

    const user = db.users.find(u => u.loginId === loginId && u.passwordHash === passwordHash);
    if (user) {
      if (user.loginId === 'admin' && user.name === '최고관리자') {
        user.name = '개발자';
      }
      setCurrentUser(user);
      sessionStorage.setItem('user', JSON.stringify(user));
      if (keepLoggedIn) {
        localStorage.setItem('auto_user', JSON.stringify(user));
      } else {
        localStorage.removeItem('auto_user');
      }
      logPrivacyAccess('LOGIN', 'login', `사용자 로그인 성공: ${user.name} (${user.department})`, {
        userId: user.loginId,
        userName: user.name
      }).catch(console.error);
      return true;
    }

    logPrivacyAccess('LOGIN', 'login', `로그인 실패 시도 (시도 ID: ${loginId})`, {
      userId: loginId,
      userName: '미식별'
    }).catch(console.error);
    return false;
  };

  const logout = () => {
    if (currentUser) {
      logPrivacyAccess('LOGOUT', 'logout', `사용자 로그아웃: ${currentUser.name}`, {
        userId: currentUser.loginId,
        userName: currentUser.name
      }).catch(console.error);
    }
    setCurrentUser(null);
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('original_admin_user');
    localStorage.removeItem('auto_user');
  };

  const switchUser = (userId: string) => {
    let targetUser = users.find(u => u.id === userId);
    if (!targetUser) {
      // sys-admin 등 users 배열에 없는 fallback 계정으로의 복귀 처리
      const originalAdminStr = sessionStorage.getItem('original_admin_user');
      if (originalAdminStr) {
        const originalAdmin = JSON.parse(originalAdminStr);
        if (originalAdmin.id === userId) {
          targetUser = originalAdmin;
        }
      }
    }
    
    if (targetUser) {
      logPrivacyAccess('VIEW', 'switch_user', `사용자 계정 전환: ${currentUser?.name || '미인증'} -> ${targetUser.name}`, {
        userId: currentUser?.loginId || targetUser.loginId,
        userName: currentUser?.name || targetUser.name,
        targetSubjectId: targetUser.id,
        targetSubjectName: targetUser.name
      }).catch(console.error);

      if (currentUser?.role === 'ADMIN' && !sessionStorage.getItem('original_admin_user')) {
        sessionStorage.setItem('original_admin_user', JSON.stringify(currentUser));
      }
      setCurrentUser(targetUser);
      sessionStorage.setItem('user', JSON.stringify(targetUser));
    }
  };

  const hasPermission = (menuId: string, action: 'view' | 'save'): boolean => {
    if (!currentUser) return false;

    // 0. 퇴사(RETIRED) 계정은 전사 모든 메뉴 권한 즉시 전면 차단 (Zero-Access Security)
    if (currentUser.status === 'RETIRED') return false;

    // 0-1. 휴직(LEAVE_OF_ABSENCE) 계정은 변경/저장(save) 권한 원천 차단 (조회만 허용)
    if (currentUser.status === 'LEAVE_OF_ABSENCE' && action === 'save') return false;

    // 1. 시스템 최고관리자 계정 및 ADMIN 역할 사용자는 모든 메뉴에 100% 무조건 권한 부여
    if (currentUser.role === 'ADMIN' || currentUser.loginId === 'admin' || currentUser.id === 'sys-admin' || currentUser.id === 'u-1') return true;

    // 2. 단일 표준(SSOT) 단수형 메뉴 ID로 정규화
    const normMenuId = normalizeMenuId(menuId);

    // 2-1. 연차신청, 매뉴얼 스튜디오 및 업무매뉴얼은 권한 구분 없이 모든 임직원의 공통 기능으로 처리 (전원 상시 개방)
    if (normMenuId === 'leave_application' || normMenuId === 'manual_studio' || normMenuId === 'operations_manual') {
      return true;
    }

    // 2-2. 연차관리 권한은 급여 권한자와 100% 동일하게 변경 (급여 권한 상속)
    if (normMenuId === 'leave_management') {
      return hasPermission('payroll', action);
    }

    // 3. 사용자 정의 권한 명칭(CustomRole) 상속 판정 (역할 기반 자동 상속 최우선)
    if (currentUser.customRoleId) {
      const rolePerm = rolePermissions.find(p => 
        p.roleId === currentUser.customRoleId && 
        normalizeMenuId(p.menuId) === normMenuId
      );
      if (rolePerm) {
        return action === 'view' ? Boolean(rolePerm.canView) : Boolean(rolePerm.canSave);
      }
    }

    // 4. 사용자별 명시적 오버라이드(개인 예외 권한) 우선 판정
    const perm = permissions.find(p => 
      (p.userId === currentUser.id || (p as any).user_id === currentUser.id) && 
      normalizeMenuId(p.menuId) === normMenuId
    );
    if (perm) {
      return action === 'view' ? Boolean(perm.canView) : Boolean(perm.canSave);
    }

    // 5. 직무 템플릿(RBAC) 기반 자동 상속 판정
    const dept = currentUser.departmentId || currentUser.department;
    const templateRule = getRoleTemplatePermission(currentUser.role, dept, normMenuId, action);
    if (templateRule !== undefined) {
      return templateRule;
    }

    // 6. 엄격한 거부 우선 (Deny-by-Default): 정의되지 않은 메뉴는 전면 차단
    return false;
  };

  const updatePermissions = async (updated: MenuPermission[]) => {
    try {
      db.permissions = updated;
      if (supabase) {
        // DB 스키마 및 레거시 role/updatedAt NOT NULL 제약 조건 우회를 위해 타임스탬프 & 기본값 부여 (userId camelCase 단일 표준 적용)
        const nowStr = new Date().toISOString();
        const payload = updated.map(p => ({
          ...p,
          userId: p.userId,
          role: (p as any).role || 'USER',
          createdAt: p.createdAt || nowStr,
          updatedAt: nowStr
        }));

        const lastCommandInfo = `supabase.from('permissions').upsert(payload[${payload.length}건], { onConflict: 'id' })`;
        const samplePayloadJson = JSON.stringify(payload.slice(0, 2), null, 2);

        const { error } = await supabase.from('permissions').upsert(payload as any[], { onConflict: 'id' });
        if (error) {
          const isSchemaCacheOrColumnError = error.message?.includes("userId") || error.code === 'PGRST204' || error.code === 'PGRST200';
          const rawErrorDetails = 
            `■ [마지막 실행 시도 명령]: ${lastCommandInfo}\n` +
            `■ [PostgREST Raw Error]:\n` +
            `  - Code: ${error.code || 'N/A'}\n` +
            `  - Message: ${error.message || 'N/A'}\n` +
            `  - Details: ${error.details || 'N/A'}\n` +
            `  - Hint: ${error.hint || 'N/A'}\n\n` +
            `■ [시도된 페이로드 샘플 (최대 2건)]:\n${samplePayloadJson}\n\n` +
            `■ [조치 안내 (개발자 도구 패치 적용 또는 Supabase SQL Editor 실행 DDL)]:\n` +
            (isSchemaCacheOrColumnError
              ? `💡 원인: Supabase DB의 permissions 테이블 컬럼 미비 또는 PostgREST 스키마 캐시 미갱신 현상입니다.\n` +
                `1) [개발자 도구] ➔ [[개발] DB 데이터 업로더] 메뉴 하단의 [⚡ 패치 자동 적용 (DB 직접 실행)] 버튼 클릭\n` +
                `2) 또는 Supabase SQL Editor에서 아래 DDL 직접 실행:\n` +
                `   ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "userId" TEXT;\n` +
                `   NOTIFY pgrst, 'reload schema';`
              : `ALTER TABLE "permissions" ADD COLUMN IF NOT EXISTS "userId" TEXT;\nNOTIFY pgrst, 'reload schema';`);

          throw new Error(rawErrorDetails);
        }
      }
      refreshAllData();
    } catch (err: any) {
      console.error('Update permissions error:', err);
      throw err;
    }
  };

  const updateGoogleConfig = async (configData: GoogleConfig) => {
    try {
      const nowIso = new Date().toISOString();
      const payload: GoogleConfig = { ...configData, updatedAt: nowIso };

      // 1. 로컬 스토리지 즉시 반영
      const currentList = [...db.googleConfigs];
      const localIndex = currentList.findIndex(cfg => cfg.id === configData.id);
      if (localIndex >= 0) {
        currentList[localIndex] = payload;
      } else {
        currentList.push({ ...payload, createdAt: nowIso });
      }
      db.googleConfigs = currentList;
      localStorage.setItem('erp_googleConfigs', JSON.stringify(currentList));

      // 2. Supabase UPSERT — 행 존재 여부와 관계없이 반드시 반영
      if (supabase) {
        const upsertPayload = { ...payload, createdAt: (payload as any).createdAt || nowIso };
        const { error } = await supabase
          .from('google_configs')
          .upsert([upsertPayload], { onConflict: 'id' });
        if (error) {
          console.error('Supabase upsert failed for google_configs:', error);
          throw error;
        }
      }

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('updateGoogleConfig Error:', err);
      showErrorModal(`⚠️ 구글 설정 원격 DB 저장 실패:\n\n${err?.message || err}`, '원격 DB 저장 오류');
      throw err;
    }
  };

  // ── 사용자 정의 권한 명칭(CustomRole) 및 권한(RolePermission) 관리 뮤테이터 ──
  const saveCustomRole = async (role: CustomRole) => {
    try {
      const now = new Date().toISOString();
      const updated = { ...role, updatedAt: now };
      if (!updated.createdAt) updated.createdAt = now;

      const list = [...db.customRoles];
      const idx = list.findIndex(r => r.id === role.id);
      if (idx > -1) {
        list[idx] = updated;
      } else {
        list.push(updated);
      }
      db.customRoles = list;
      setCustomRoles([...list]);

      await db.upsertRows('customRoles', [updated]);
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('saveCustomRole error:', err);
      showErrorModal(`권한 명칭 저장 실패: ${err?.message || err}`);
      throw err;
    }
  };

  const deleteCustomRole = async (roleId: string) => {
    try {
      const list = db.customRoles.filter(r => r.id !== roleId);
      db.customRoles = list;
      setCustomRoles([...list]);

      // 해당 역할의 세부 메뉴 권한 삭제
      const remainingPerms = db.rolePermissions.filter(p => p.roleId !== roleId);
      db.rolePermissions = remainingPerms;
      setRolePermissions([...remainingPerms]);

      // 해당 역할을 상속받은 사용자들의 customRoleId 해제
      const updatedUsers = db.users.map(u => u.customRoleId === roleId ? { ...u, customRoleId: undefined } : u);
      db.users = updatedUsers;
      setUsers([...updatedUsers]);

      await db.deleteRow('customRoles', roleId);
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('deleteCustomRole error:', err);
      showErrorModal(`권한 명칭 삭제 실패: ${err?.message || err}`);
      throw err;
    }
  };

  const saveRolePermissions = async (roleId: string, perms: { menuId: string; canView: boolean; canSave: boolean }[]) => {
    try {
      const now = new Date().toISOString();
      const otherPerms = db.rolePermissions.filter(p => p.roleId !== roleId);
      const newPerms: RolePermission[] = perms.map(p => ({
        id: `roleperm-${roleId}-${normalizeMenuId(p.menuId)}`,
        roleId,
        menuId: normalizeMenuId(p.menuId),
        canView: p.canView,
        canSave: p.canSave,
        createdAt: now,
        updatedAt: now
      }));
      const combined = [...otherPerms, ...newPerms];
      db.rolePermissions = combined;
      setRolePermissions([...combined]);

      await db.upsertRows('rolePermissions', newPerms);
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('saveRolePermissions error:', err);
      showErrorModal(`역할 메뉴 권한 저장 실패: ${err?.message || err}`);
      throw err;
    }
  };

  const assignUserRole = async (userId: string, customRoleId: string | null) => {
    try {
      const list = [...db.users];
      const idx = list.findIndex(u => u.id === userId);
      if (idx > -1) {
        const updatedUser = { 
          ...list[idx], 
          customRoleId: customRoleId || undefined, 
          updatedAt: new Date().toISOString() 
        };
        list[idx] = updatedUser;
        db.users = list;
        setUsers([...list]);

        if (currentUser?.id === userId) {
          setCurrentUser(updatedUser);
        }

        await db.upsertRows('users', [updatedUser]);
        await db.awaitPendingWrites();
        refreshAllData();
      }
    } catch (err: any) {
      console.error('assignUserRole error:', err);
      showErrorModal(`직원 권한 명칭 상속 배정 실패: ${err?.message || err}`);
      throw err;
    }
  };

  const saveUser = (userData: Omit<User, 'id' | 'createdAt'> & { id?: string }) => {
    if (userData.id) {
      db.updateRow<User>('users', userData.id, userData);
    } else {
      // 신규 임직원 생성
      const newUser = db.insertRow<User>('users', { ...userData, createdAt: new Date().toISOString() });
      
      // ADMIN 역할 신규 임직원은 모든 메뉴에 대해 기본 전체 권한(canView+canSave=true) 레코드 자동 생성
      if (userData.role === 'ADMIN' && newUser?.id) {
        const allMenuIds = getAllSystemMenuIds();
        allMenuIds.forEach(menuId => {
          const exists = db.permissions.some(p => p.userId === newUser.id && p.menuId === menuId);
          if (!exists) {
            const perm = createMenuPermission(newUser.id, menuId, true, true);
            db.insertRow<MenuPermission>('permissions', perm);
          }
        });
      }
    }
    refreshAllData();
  };

  const saveCustomer = async (cust: Omit<Customer, 'id' | 'createdAt'> & { id?: string }): Promise<Customer> => {
    let res: Customer;
    if (cust.id) {
      res = db.updateRow<Customer>('customers', cust.id, cust) as Customer;

      // 고객 정보 보완 완료 시 관련 할 일(Todo) 자동 상계 처리
      const relatedTodos = db.todos.filter(
        t => t.relatedEntityId === cust.id && t.type === 'MISSING_INFO' && !t.isCompleted
      );
      if (relatedTodos.length > 0) {
        const isInfoComplete = 
          cust.bizRegNo && cust.bizRegNo !== '미상' && cust.bizRegNo.trim() !== '' &&
          cust.representative && cust.representative !== '미상' && cust.representative.trim() !== '' &&
          cust.repContact && cust.repContact !== '미상' && cust.repContact.trim() !== '' &&
          cust.address && cust.address !== '미상' && cust.address.trim() !== '' &&
          cust.repEmail && cust.repEmail !== '미상' && cust.repEmail.trim() !== '';

        if (isInfoComplete) {
          relatedTodos.forEach(todo => {
            db.updateRow<Todo>('todos', todo.id, { isCompleted: true });
          });
        }
      }
    } else {
      res = db.insertRow<Customer>('customers', { ...cust, createdAt: new Date().toISOString() }) as Customer;
    }

    if (db.isSupabaseConnected() && db.pendingWrites.length > 0) {
      try {
        await db.pendingWrites[db.pendingWrites.length - 1];
      } catch (err) {
        console.error("Supabase write await error:", err);
        throw err;
      }
    }

    refreshAllData();
    return res;
  };

  const saveContact = async (contact: Omit<CustomerContact, 'id' | 'createdAt'> & { id?: string }) => {
    if (contact.id) {
      db.updateRow<CustomerContact>('contacts', contact.id, contact as CustomerContact);
    } else {
      db.insertRow<CustomerContact>('contacts', {
        ...contact,
        isActive: contact.isActive !== undefined ? contact.isActive : true,
        createdAt: new Date().toISOString()
      } as Omit<CustomerContact, 'id'>);
    }

    if (db.isSupabaseConnected() && db.pendingWrites.length > 0) {
      try {
        await db.pendingWrites[db.pendingWrites.length - 1];
      } catch (err) {
        console.error("Supabase write await error:", err);
        throw err;
      }
    }

    refreshAllData();
  };

  const deleteContact = async (id: string) => {
    // ✅ 고아 레코드 방지: 계약에 등록된 담당자 삭제 차단
    const linkedContracts = db.contracts.filter(c => c.contactId === id);
    if (linkedContracts.length > 0) {
      showErrorModal(
        `⚠️ 해당 담당자를 삭제할 수 없습니다.\n\n연결된 계약이 ${linkedContracts.length}건 존재합니다.\n계약에서 담당자를 먼저 변경/해제하십시오.`,
        '담당자 삭제 불가'
      );
      return;
    }
    db.deleteRow('contacts', id);
    if (db.isSupabaseConnected() && db.pendingWrites.length > 0) {
      try {
        await db.pendingWrites[db.pendingWrites.length - 1];
      } catch (err) {
        console.error("Supabase write await error:", err);
        throw err;
      }
    }
    refreshAllData();
  };

  const saveSite = async (site: Omit<CustomerSite, 'id' | 'createdAt'> & { id?: string }) => {
    if (site.id) {
      db.updateRow<CustomerSite>('sites', site.id, site as CustomerSite);
    } else {
      db.insertRow<CustomerSite>('sites', {
        ...site,
        isActive: site.isActive !== undefined ? site.isActive : true,
        createdAt: new Date().toISOString()
      } as Omit<CustomerSite, 'id'>);
    }

    if (db.isSupabaseConnected() && db.pendingWrites.length > 0) {
      try {
        await db.pendingWrites[db.pendingWrites.length - 1];
      } catch (err) {
        console.error("Supabase write await error:", err);
        throw err;
      }
    }

    refreshAllData();
  };

  const deleteSite = async (id: string) => {
    // ✅ 고아 레코드 방지: 연결된 계약 또는 투입 중인 장비가 있으면 삭제 차단
    const linkedContracts = db.contracts.filter(c => c.siteId === id);
    const linkedAssets = db.assets.filter(a => a.currentSiteId === id);
    if (linkedContracts.length > 0 || linkedAssets.length > 0) {
      showErrorModal(
        `⚠️ 해당 현장을 삭제할 수 없습니다.\n\n` +
        (linkedContracts.length > 0 ? `■ 연결된 계약: ${linkedContracts.length}건\n` : '') +
        (linkedAssets.length > 0 ? `■ 투입 중인 장비: ${linkedAssets.length}대\n` : '') +
        `\n계약 또는 장비에서 현장 연결을 먼저 해제하십시오.`,
        '현장 삭제 불가'
      );
      return;
    }
    db.deleteRow('sites', id);
    if (db.isSupabaseConnected() && db.pendingWrites.length > 0) {
      try {
        await db.pendingWrites[db.pendingWrites.length - 1];
      } catch (err) {
        console.error("Supabase write await error:", err);
        throw err;
      }
    }
    refreshAllData();
  };

  const saveProduct = async (prod: Omit<Product, 'id' | 'createdAt'> & { id?: string }) => {
    let result;
    if (prod.id) {
      result = db.updateRow<Product>('products', prod.id, prod as Product);
    } else {
      result = db.insertRow<Product>('products', {
        ...prod,
        isActive: prod.isActive !== undefined ? prod.isActive : true,
        createdAt: new Date().toISOString()
      } as Omit<Product, 'id'>);
    }
    
    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error("Supabase write await error:", err);
      showErrorModal(`⚠️ 제품 카탈로그 저장 중 DB 동기화 오류가 발생했습니다:\n${err.message || err.details || JSON.stringify(err)}`, 'DB 동기화 오류');
      throw err;
    }
    
    refreshAllData();
    return result;
  };

  // 💡 [신규] 입고 검수 필요 항목 및 점수 기준 CUD
  const saveInspectionChecklistItem = async (itemData: Omit<InspectionChecklistItem, 'id' | 'createdAt'> & { id?: string }) => {
    if (itemData.id) {
      db.updateRow<InspectionChecklistItem>('inspectionChecklistItems', itemData.id, {
        ...itemData
      });
    } else {
      const nextId = db.generateNextId('inspectionChecklistItems', db.inspectionChecklistItems);
      db.insertRow<InspectionChecklistItem>('inspectionChecklistItems', {
        ...itemData,
        id: nextId,
        createdAt: new Date().toISOString()
      });
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const deleteInspectionChecklistItem = async (id: string) => {
    db.deleteRow('inspectionChecklistItems', id);
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const saveEquipmentManual = async (manualData: Omit<EquipmentManual, 'id' | 'createdAt'> & { id?: string }) => {
    if (manualData.id) {
      db.updateRow<EquipmentManual>('equipmentManuals', manualData.id, {
        ...manualData,
        updatedAt: new Date().toISOString()
      });
    } else {
      const nextId = db.generateNextId('equipmentManuals', db.equipmentManuals);
      db.insertRow<EquipmentManual>('equipmentManuals', {
        ...manualData,
        id: nextId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const deleteEquipmentManual = async (id: string) => {
    db.deleteRow('equipmentManuals', id);
    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 🏷️ 전사 표준 옵션 마스터 CUD
  const saveStandardOption = async (optionData: Omit<StandardOption, 'id' | 'createdAt'> & { id?: string }): Promise<StandardOption> => {
    let result: StandardOption;
    if (optionData.id) {
      result = db.updateRow<StandardOption>('standardOptions', optionData.id, {
        ...optionData,
        updatedAt: new Date().toISOString()
      }) as StandardOption;
    } else {
      const nextId = 'opt_' + Date.now();
      result = db.insertRow<StandardOption>('standardOptions', {
        ...optionData,
        id: nextId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }) as StandardOption;
    }
    await db.awaitPendingWrites();
    refreshAllData();
    return result;
  };

  const deleteStandardOption = async (id: string): Promise<void> => {
    db.deleteRow('standardOptions', id);
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const saveAsset = async (asset: Omit<Asset, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => {
    let result;
    const isNew = !asset.id;
    const existingAsset = asset.id ? db.assets.find(a => a.id === asset.id) : null;

    if (asset.id) {
      result = db.updateRow<Asset>('assets', asset.id, asset as Asset);
    } else {
      result = db.insertRow<Asset>('assets', {
        ...asset,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as Omit<Asset, 'id'>);
    }

    if (result) {
      // 1. 신규 취득(ACQUISITION) 이력 자동 기록
      if (isNew) {
        db.insertRow<AssetInOutLog>('assetInOutLogs', {
          assetId: result.id,
          assetNo: result.assetNo,
          modelName: result.modelName,
          type: 'ACQUISITION',
          eventDate: result.acquisitionDate || new Date().toISOString().split('T')[0],
          memo: `자산 최초 취득 및 대장 등록 (취득일: ${result.acquisitionDate || '-'} / 취득가: ${(result.acquisitionPrice || 0).toLocaleString()}원 / 임차/구입처: ${result.renter || '-'})`,
          createdAt: new Date().toISOString()
        });
      }

      // 2. 자산 매각(DISPOSAL) 이력 자동 기록
      if (result.status === 'SOLD' && (!existingAsset || existingAsset.status !== 'SOLD')) {
        db.insertRow<AssetInOutLog>('assetInOutLogs', {
          assetId: result.id,
          assetNo: result.assetNo,
          modelName: result.modelName,
          type: 'DISPOSAL',
          eventDate: result.disposalDate || new Date().toISOString().split('T')[0],
          memo: `자산 매각 완료 (매각일: ${result.disposalDate || '-'} / 매각가: ${(result.disposalPrice || 0).toLocaleString()}원 / 매각인수처: ${result.buyer || '-'})`,
          createdAt: new Date().toISOString()
        });
      }
    }

    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error('saveAsset Supabase sync error:', err);
      showErrorModal(`⚠️ 장비 자산 저장 중 DB 동기화 오류가 발생했습니다:\n${err.message || err.details || JSON.stringify(err)}`, 'DB 동기화 오류');
      throw err;
    }
    refreshAllData();
    return result;
  };

  // 💡 자산 상태 SSOT 실시간 자동 변동 헬퍼 메소드
  const changeAssetStatus = async (assetId: string, newStatus: Asset['status'], extraData?: Partial<Asset>) => {
    try {
      const targetAsset = db.assets.find(a => a.id === assetId);
      if (!targetAsset) return;

      const updatedPayload: Partial<Asset> = {
        status: newStatus,
        ...extraData
      };

      db.updateRow<Asset>('assets', assetId, updatedPayload);

      // 자산 입출고/상태 변동 이력(assetInOutLogs) 자동 타임라인 기록
      db.insertRow<AssetInOutLog>('assetInOutLogs', {
        assetId: assetId,
        assetNo: targetAsset.assetNo || '',
        modelName: targetAsset.modelName || '',
        type: (newStatus === 'RENTED' || newStatus === 'ASSIGNED') ? 'OUTBOUND' : 'INBOUND',
        eventDate: new Date().toISOString().split('T')[0],
        memo: `[자산상태 실시간 변동] ${targetAsset.status || 'AVAILABLE'} ➔ ${newStatus}`,
        createdAt: new Date().toISOString()
      });

      if (db.isSupabaseConnected() && db.pendingWrites.length > 0) {
        await db.awaitPendingWrites();
      }
      refreshAllData();
    } catch (err: any) {
      console.error('changeAssetStatus error:', err);
      showErrorModal(`⚠️ 자산 상태 변동 처리 중 오류가 발생했습니다:\n\n${err?.message || err}`);
      throw err;
    }
  };

  // 전사 계약번호 통일 생성 헬퍼 (YYMM + 4자리 순차: 예 '26070001')
  const generateNextContractNo = (): string => {
    const prefix = new Date().toISOString().split('T')[0].replace(/-/g, '').substring(2, 6); // e.g. "2607"
    let maxSeq = 0;
    
    db.contracts.forEach(c => {
      if (!c || !c.contractNo) return;
      const match = c.contractNo.match(new RegExp(`${prefix}(\\d{4})`)) || c.contractNo.match(/(\d{8})/);
      if (match) {
        const str = match[1] || match[0];
        if (str.length === 8 && str.startsWith(prefix)) {
          const seq = parseInt(str.substring(4), 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        } else if (str.length === 4) {
          const seq = parseInt(str, 10);
          if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
        }
      }
    });

    const nextSeq = String(maxSeq + 1).padStart(4, '0');
    return `${prefix}${nextSeq}`;
  };

  const saveSmartDispatch = async (data: SmartDispatchData, autoRegister: boolean, onProgress?: (log: string, percent: number) => void) => {
    const notify = async (msg: string, pct: number, delayMs = 180) => {
      if (onProgress) {
        onProgress(msg, pct);
        await new Promise(r => setTimeout(r, delayMs));
      }
    };

    await notify('🔍 [1/5] 고객사 명칭 정규화 및 거래 상태 확인 중...', 10);

    // 약칭("세보엠이씨") 또는 표기 형태(" (주) 세보엠이씨 ") 검색 시 기존 정식 법인명("주식회사 세보엠이씨") 자동 탐색 & 보정
    let customer = findCustomerByNormalizedName(db.customers, data.customerName);
    if (customer) {
      // 약칭 입력을 정식 등록 명칭으로 자동 치환/보정!
      data.customerName = customer.name;
    }
    if (customer && customer.transactionStatus === 'BLOCKED') {
      return { success: false, errorMessage: '⚠️ 해당 고객사는 [거래불가] 상태로 설정되어 있어 신규 출고 및 계약 등록이 원천 차단됩니다.' };
    }
    
    // 🛡️ [1. 방어 가드 - Validation Guard]
    // 현장 상세 주소와 현장담당자 연락처가 입력값과 기존 DB 모두에 전혀 없는 경우 강력 방어
    const currentCust = customer;
    const existingSite = currentCust ? db.sites.find(s => s.customerId === currentCust.id && (s.name.replace(/\s/g, '') === data.siteName.replace(/\s/g, '') || s.name.includes(data.siteName) || data.siteName.includes(s.name))) : null;
    const existingContact = currentCust ? db.contacts.find(ct => ct.customerId === currentCust.id && (data.siteContactName ? ct.name.replace(/\s/g, '') === data.siteContactName.replace(/\s/g, '') : true)) : null;

    const effectiveAddress = data.siteAddress?.trim() || (existingSite?.address && existingSite.address !== '미상' ? existingSite.address : '');
    const effectivePhone = data.siteContactPhone?.trim() || (existingSite?.contact && existingSite.contact !== '미상' ? existingSite.contact : '') || (existingContact?.contact && existingContact.contact !== '미상' ? existingContact.contact : '');

    if (!effectiveAddress) {
      return {
        success: false,
        errorMessage: `⚠️ [현장 상세 주소 필수 누락]\n\n고객사 '${data.customerName}' / 현장 '${data.siteName}'의 기존 DB에 등록된 주소가 없으며, 현재 입력창에도 주소가 생략되어 있습니다.\n\n배차 기사 운송 및 계약 체결을 위해 현장 상세 주소를 반드시 입력해주세요.`
      };
    }
    if (!effectivePhone) {
      return {
        success: false,
        errorMessage: `⚠️ [현장 담당자 연락처 필수 누락]\n\n고객사 '${data.customerName}' / 현장 '${data.siteName}'의 현장 담당자 연락처가 기존 DB에 없으며 입력창에도 생략되었습니다.\n\n장비 하차 인계 및 기사 비상 연락을 위해 현장 담당자 연락처를 반드시 입력해주세요.`
      };
    }

    // ⚡ [2. 기존 정보 상속] 누락 필드 자동 승계
    data.siteAddress = effectiveAddress;
    if (!data.siteContactPhone?.trim()) data.siteContactPhone = effectivePhone;
    if (!data.siteContactName?.trim() && existingSite?.contactName && existingSite.contactName !== '미상') {
      data.siteContactName = existingSite.contactName;
    }
    if (!data.taxBillEmail?.trim() && customer?.repEmail && customer.repEmail !== '미상') {
      data.taxBillEmail = customer.repEmail;
    }

    // 🛡️ [장비 수량 검증 가드]
    if (!data.equipments || data.equipments.length === 0) {
      return { success: false, errorMessage: '⚠️ 출고 대상 장비 규격 및 수량이 누락되었습니다.' };
    }
    const sanitizedEquipments = data.equipments.map(eq => ({
      ...eq,
      qty: Math.max(1, Math.floor(Number(eq.qty) || 1))
    }));
    const totalEqQty = sanitizedEquipments.reduce((sum, e) => sum + e.qty, 0);
    if (totalEqQty <= 0) {
      return { success: false, errorMessage: '⚠️ 출고 수량은 최소 1대 이상이어야 합니다.' };
    }
    data.equipments = sanitizedEquipments;

    const missingFields = [];
    if (!customer) missingFields.push(`고객사: ${data.customerName}`);
    if (!existingSite) missingFields.push(`현장: ${data.siteName}`);

    if (missingFields.length > 0 && !autoRegister) {
      return { success: false, requiresConfirm: true, missingFields };
    }

    const rawData = data as any;
    const parseDayNumber = (val: any, fallback: number): number => {
      if (val === undefined || val === null || val === '') return fallback;
      const str = String(val).trim();
      if (str.includes('말일') || str.includes('월말')) return 31;
      const matched = str.match(/\d+/);
      if (matched) {
        const n = parseInt(matched[0], 10);
        return Math.min(31, Math.max(1, n));
      }
      return fallback;
    };
    const contractBillingDay = parseDayNumber(rawData.closingDay, customer?.defaultBillingDay || 30);
    const contractStatementClosingDay = parseDayNumber(rawData.statementClosingDay, customer?.defaultStatementClosingDay || 25);
    const contractPaymentDueDay = parseDayNumber(rawData.paymentDay || rawData.paymentDueDay, customer?.paymentDueDay || 15);

    if (!customer) {
      await notify(`🏢 [신규 고객] DB에 없는 고객사 '${data.customerName}' 자동 신규 생성 중...`, 20);
      customer = db.insertRow<Customer>('customers', {
        name: data.customerName,
        bizRegNo: '미상',
        isClosed: false,
        address: data.siteAddress || '미상',
        representative: '미상',
        repContact: data.siteContactPhone || '미상',
        repEmail: data.taxBillEmail || data.statementEmail || '미상',
        defaultBillingDay: contractBillingDay,
        defaultStatementClosingDay: contractStatementClosingDay,
        paymentDueDay: contractPaymentDueDay,
        createdAt: new Date().toISOString()
      });

      // ⚠️ FK 제약 방지: 신규 고객이 Supabase에 완전히 저장된 후에만 contacts/sites 생성 가능
      try {
        await db.awaitPendingWrites();
      } catch (err: any) {
        console.error('Supabase new customer sync error:', err);
        showErrorModal(`⚠️ 신규 고객 DB 저장 중 오류:\n${err.message || JSON.stringify(err)}`, '스마트 출고 오류');
        return { success: false, errorMessage: err.message };
      }

      if (data.siteContactName) {
        db.insertRow<CustomerContact>('contacts', {
          customerId: customer.id,
          name: data.siteContactName,
          position: '현장담당자',
          contact: data.siteContactPhone || '미상',
          email: data.siteContactEmail || '미상',
          createdAt: new Date().toISOString()
        });
      }
    } else {
      await notify(`✅ [고객 확인] 기존 등록 고객사 '${customer.name}' 매핑 완료`, 25);
      
      // 🔄 [3. 최신 정보 업데이트] 고객 마스터 정보 동기화
      const custUpdates: Partial<Customer> = {};
      if (data.taxBillEmail && data.taxBillEmail !== '미상' && data.taxBillEmail !== customer.repEmail) {
        custUpdates.repEmail = data.taxBillEmail;
      }
      if (Object.keys(custUpdates).length > 0) {
        customer = db.updateRow<Customer>('customers', customer.id, { ...custUpdates, updatedAt: new Date().toISOString() }) as Customer;
        await notify(`🏢 [고객 정보 갱신] 계산서 수신처('${data.taxBillEmail}')가 고객 마스터에 업데이트되었습니다.`, 28);
      }

      // 담당자 정보 업데이트 및 신규 추가
      if (data.siteContactName) {
        const targetCustomerId = customer.id;
        const matchedContact = db.contacts.find(ct => ct.customerId === targetCustomerId && ct.name.replace(/\s/g, '') === data.siteContactName.replace(/\s/g, ''));
        if (matchedContact) {
          if ((data.siteContactPhone && data.siteContactPhone !== '미상' && data.siteContactPhone !== matchedContact.contact) || (data.siteContactEmail && data.siteContactEmail !== '미상' && data.siteContactEmail !== matchedContact.email)) {
            db.updateRow<CustomerContact>('contacts', matchedContact.id, {
              contact: data.siteContactPhone || matchedContact.contact,
              email: data.siteContactEmail || matchedContact.email,
              updatedAt: new Date().toISOString()
            });
            await notify(`👤 [담당자 최신화] 담당자 '${data.siteContactName}' 연락처가 최신값으로 업데이트되었습니다.`, 30);
          }
        } else {
          await notify(`👤 [신규 담당자] 현장 담당자 '${data.siteContactName}' 등록 중...`, 30);
          db.insertRow<CustomerContact>('contacts', {
            customerId: targetCustomerId,
            name: data.siteContactName,
            position: '현장담당자',
            contact: data.siteContactPhone || '미상',
            email: data.siteContactEmail || '미상',
            createdAt: new Date().toISOString()
          });
        }
      }

      if (data.billingContactName) {
        const targetCustomerId = customer.id;
        const matchedBilling = db.contacts.find(ct => ct.customerId === targetCustomerId && ct.name.replace(/\s/g, '') === data.billingContactName.replace(/\s/g, ''));
        if (!matchedBilling) {
          db.insertRow<CustomerContact>('contacts', {
            customerId: targetCustomerId,
            name: data.billingContactName,
            position: '청구담당자',
            contact: data.billingContactPhone || '미상',
            email: data.taxBillEmail || data.statementEmail || '미상',
            createdAt: new Date().toISOString()
          });
        }
      }
    }

    const finalCustomer = customer;

    // 현장(Site) 처리: 기존 현장 업데이트 또는 신규 현장 등록
    let site = db.sites.find(s => s.customerId === finalCustomer.id && (s.name.replace(/\s/g, '') === data.siteName.replace(/\s/g, '') || s.name.includes(data.siteName) || data.siteName.includes(s.name)));
    if (!site) {
      await notify(`📍 [2/5 신규 현장] 신규 현장 '${data.siteName}' 자동 등록 중...`, 40);
      site = db.insertRow<CustomerSite>('sites', {
        customerId: finalCustomer.id,
        name: data.siteName,
        address: data.siteAddress || '미상',
        contactName: data.siteContactName || '미상',
        contact: data.siteContactPhone || '미상',
        email: data.siteContactEmail || '미상',
        paidOptions: data.paidOptions || undefined,
        protection: data.protection || undefined,
        checkedSpecs: data.checkedSpecs || undefined,
        billingDay: contractBillingDay,
        statementClosingDay: contractStatementClosingDay,
        paymentDueDay: contractPaymentDueDay,
        createdAt: new Date().toISOString()
      });
    } else {
      // 기존 현장 정보가 '미상'이거나 변경된 경우 최신값으로 업데이트!
      const siteUpdates: Partial<CustomerSite> = {};
      if (data.siteAddress && data.siteAddress !== '미상' && data.siteAddress !== site.address) {
        siteUpdates.address = data.siteAddress;
      }
      if (data.siteContactName && data.siteContactName !== '미상' && data.siteContactName !== site.contactName) {
        siteUpdates.contactName = data.siteContactName;
      }
      if (data.siteContactPhone && data.siteContactPhone !== '미상' && data.siteContactPhone !== site.contact) {
        siteUpdates.contact = data.siteContactPhone;
      }
      if (data.siteContactEmail && data.siteContactEmail !== '미상' && data.siteContactEmail !== site.email) {
        siteUpdates.email = data.siteContactEmail;
      }
      if (rawData.closingDay !== undefined) {
        siteUpdates.billingDay = contractBillingDay;
      }
      if (rawData.statementClosingDay !== undefined) {
        siteUpdates.statementClosingDay = contractStatementClosingDay;
      }
      if (rawData.paymentDay !== undefined || rawData.paymentDueDay !== undefined) {
        siteUpdates.paymentDueDay = contractPaymentDueDay;
      }
      // 🌟 옵션 변경 시 현장 마스터 저장 여부 확인 (false인 경우 이번 출고만 1회성 적용하고 현장 마스터는 기존 옵션 원형 보존)
      if (data.saveOptionsToSite !== false) {
        if (data.paidOptions !== undefined && data.paidOptions !== site.paidOptions) {
          siteUpdates.paidOptions = data.paidOptions;
        }
        if (data.protection !== undefined && data.protection !== site.protection) {
          siteUpdates.protection = data.protection;
        }
        if (data.checkedSpecs && Object.keys(data.checkedSpecs).length > 0) {
          siteUpdates.checkedSpecs = data.checkedSpecs;
        }
      }
      if (Object.keys(siteUpdates).length > 0) {
        site = db.updateRow<CustomerSite>('sites', site.id, { ...siteUpdates, updatedAt: new Date().toISOString() }) as CustomerSite;
        await notify(`📍 [현장 정보 최신화] 현장 '${site.name}'의 정보(주소/옵션/보양)가 고객 마스터에 업데이트되었습니다.`, 45);
      } else {
        await notify(`📍 [2/5 현장 매핑] 기존 현장 '${site.name}' 매핑 완료`, 45);
      }
    }

    // 🌟 고객사 기본 옵션/보양 등록 및 전체 현장 일괄 전파 처리
    const custOptionUpdates: Partial<Customer> = {};
    if (data.isSetAsCustomerDefault || (!finalCustomer.defaultPaidOptions && data.paidOptions)) {
      if (data.paidOptions) custOptionUpdates.defaultPaidOptions = data.paidOptions;
    }
    if (data.isSetAsCustomerDefault || (!finalCustomer.defaultProtection && data.protection)) {
      if (data.protection) custOptionUpdates.defaultProtection = data.protection;
    }
    if (data.isSetAsCustomerDefault || (!finalCustomer.defaultCheckedSpecs && data.checkedSpecs && Object.keys(data.checkedSpecs).length > 0)) {
      if (data.checkedSpecs) custOptionUpdates.defaultCheckedSpecs = data.checkedSpecs;
    }
    if (Object.keys(custOptionUpdates).length > 0) {
      db.updateRow<Customer>('customers', finalCustomer.id, { ...custOptionUpdates, updatedAt: new Date().toISOString() });
      await notify(`🏢 [고객사 기본설정 동기화] 고객사('${finalCustomer.name}') 기본 옵션/보양 마스터가 등록되었습니다.`, 48);
    }

    if (data.applyToAllSites) {
      const allSites = db.sites.filter(s => s.customerId === finalCustomer.id);
      for (const s of allSites) {
        db.updateRow<CustomerSite>('sites', s.id, {
          paidOptions: data.paidOptions || s.paidOptions,
          protection: data.protection || s.protection,
          checkedSpecs: data.checkedSpecs || s.checkedSpecs,
          updatedAt: new Date().toISOString()
        });
      }
      await notify(`🌐 [전체 현장 전파] '${finalCustomer.name}' 산하 ${allSites.length}개 모든 현장에 옵션/보양이 일괄 적용되었습니다.`, 50);
    }

    if (autoRegister && currentUser) {
      db.insertRow<Todo>('todos', {
        userId: currentUser.id,
        type: 'MISSING_INFO',
        title: `신규 고객/현장 정보 보완 (${data.customerName})`,
        content: `스마트 출고 요청 시 사업자등록번호 등 미상으로 처리된 필수 항목을 채워주세요.`,
        isCompleted: false,
        relatedEntityId: finalCustomer.id,
        createdAt: new Date().toISOString()
      });
    }

    const finalSite = site!;

    const existingUsers = db.users;
    const isSalespersonValid = currentUser?.id && existingUsers.some(u => u.id === currentUser.id);
    const validSalespersonId = isSalespersonValid ? currentUser.id : (existingUsers.find(u => u.id === 'u-1')?.id || existingUsers[0]?.id || undefined);

    const nextContractNo = generateNextContractNo();

    await notify(`📄 [3/5 계약 생성] 스마트 임대차 계약서 작성 중 (${nextContractNo})...`, 55);

    const contractLateInterestRate = (rawData.lateInterestRate !== undefined && rawData.lateInterestRate !== '') ? (Number(rawData.lateInterestRate) || 0) : ((finalCustomer as any).defaultLateInterestRate || 0);

    const extractDate = (dateTimeStr?: string): string => {
      if (!dateTimeStr) return '';
      const match = dateTimeStr.match(/\d{4}-\d{2}-\d{2}/);
      return match ? match[0] : '';
    };
    const targetStartDate = extractDate(data.loadingTime) || extractDate(data.unloadingTime) || new Date().toISOString().split('T')[0];

    const contract = db.insertRow<Contract>('contracts', {
      contractNo: nextContractNo,
      contractType: 'RENTAL',
      customerId: finalCustomer.id,
      siteId: finalSite.id,
      startDate: targetStartDate,
      endDate: '', 
      billingDay: contractBillingDay,
      statementClosingDay: contractStatementClosingDay,
      lateInterestRate: contractLateInterestRate,
      paymentDueDay: contractPaymentDueDay,
      salespersonId: validSalespersonId,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // ⚠️ 외래키(Foreign Key) 제약조건 위반 방지: 부모 contract 레코드가 Supabase 원격 DB에 먼저 100% 생성되도록 1차 동기 대기!
    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error('Supabase contract insert sync error:', err);
      showErrorModal(`⚠️ 스마트 출고 계약 생성 중 DB 동기화 오류가 발생했습니다:\n${err.message || err.details || JSON.stringify(err)}`, '스마트 출고 DB 동기화 오류');
      return { success: false, errorMessage: err.message || err.details };
    }

    // 📜 [헌장 1.2] 발생 사건 무누락 DB 저장: 스마트 출고 신규 계약 체결 이력 등록
    db.insertRow<ContractHistory>('contractHistory', {
      contractId: contract.id,
      changeType: 'REGISTER',
      changeDate: contract.startDate,
      newEndDate: '',
      description: `[스마트출고] 신규 임대차 계약 체결 (${finalCustomer.name} / ${finalSite.name} - ${data.equipments.map(e => `${e.modelName} ${e.qty}대`).join(', ')})`,
      createdAt: new Date().toISOString()
    });

    await notify('🏗️ [4/5 장비 매핑] 계약 투입 장비 모델 및 단가 자동 상속 중...', 80);

    const custContractIds = db.contracts.filter(c => c.customerId === finalCustomer.id).map(c => c.id);

    data.equipments.forEach((eq) => {
      const eqData = eq as any;
      const count = Math.max(1, Math.floor(Number(eq.qty) || 1));

      // 1. 명시된 단가 확인 (모바일 발주 등)
      let determinedMonthly = Number(eqData.monthlyRent || eqData.monthlyRentalFee) || 0;
      let determinedDaily = Number(eqData.dailyRent || eqData.dailyRentalFee) || 0;

      // 2. 미입력 시 고객사의 동일 모델 최근 계약 단가 자동 상속 (헌장 2.2)
      if (!determinedMonthly && finalCustomer?.id) {
        const recentCustCA = db.contractAssets
          .filter(ca => custContractIds.includes(ca.contractId) && ca.expectedModel === eq.modelName && ca.monthlyRentalFee > 0)
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
        if (recentCustCA) {
          determinedMonthly = recentCustCA.monthlyRentalFee;
          determinedDaily = recentCustCA.dailyRentalFee || Math.round(determinedMonthly / 30);
        }
      }

      // 3. 미입력 시 자산 마스터 동일 모델의 표준 월 렌탈료 상속
      if (!determinedMonthly) {
        const peerAsset = db.assets.find(a => a.modelName === eq.modelName && (a.monthlyRentalFee || a.dailyRentalFee));
        if (peerAsset) {
          determinedMonthly = peerAsset.monthlyRentalFee || 0;
          determinedDaily = peerAsset.dailyRentalFee || (determinedMonthly ? Math.round(determinedMonthly / 30) : 0);
        }
      }

      // 4. 모델명 규격 기반 표준 단가 추정
      if (!determinedMonthly) {
        const m = (eq.modelName || '').toUpperCase();
        if (m.includes('53') || m.includes('1614')) determinedMonthly = 1500000;
        else if (m.includes('46') || m.includes('1412')) determinedMonthly = 1200000;
        else if (m.includes('40') || m.includes('1212')) determinedMonthly = 900000;
        else if (m.includes('32') || m.includes('1012')) determinedMonthly = 600000;
        else if (m.includes('26') || m.includes('0812')) determinedMonthly = 500000;
        else determinedMonthly = 400000;
        determinedDaily = Math.round(determinedMonthly / 30);
      }

      for(let i=0; i<count; i++) {
        db.insertRow<ContractAsset>('contractAssets', {
          contractId: contract.id,
          assetId: '',
          expectedModel: eq.modelName,
          monthlyRentalFee: determinedMonthly,
          dailyRentalFee: determinedDaily,
          startDate: contract.startDate,
          endDate: '',
          createdAt: new Date().toISOString()
        });
      }
    });

    await notify('🚚 [5/5 배차 생성] 배차/운송 관리 출고대기 지시건 생성 중...', 90);

    // 신규 배차(Delivery) - 출고 대기 건 자동 생성
    const cargoItems = JSON.stringify(data.equipments.map(e => ({ modelName: e.modelName, count: Number(e.qty) || 1 })));
    const dData = data as any;
    const loadingDateStr = extractDate(data.loadingTime) || contract.startDate;
    const getTimeSlot = (tStr: string | undefined) => {
      if (!tStr) return '오전';
      if (tStr.includes('ASAP')) return 'ASAP';
      if (tStr.includes('오전')) return '오전';
      if (tStr.includes('오후')) return '오후';
      const m = tStr.match(/\d{1,2}:\d{2}/);
      return m ? m[0] : (tStr.includes(' ') ? tStr.split(' ')[1] : '오전');
    };
    const loadingTimeSlotStr = getTimeSlot(data.loadingTime);
    const unloadingDateStr = extractDate(data.unloadingTime) || contract.startDate;
    const unloadingTimeSlotStr = getTimeSlot(data.unloadingTime);

    const isExchangeDelivery = dData.type === 'EXCHANGE' || dData.context?.includes('EXCHANGE') || dData.rawText?.includes('교환');
    const isCustomerPaid = dData.paidBy === 'CUSTOMER' || !!dData.billableToCustomer;

    const retrievalMemo = dData.retrievalAssetIds && dData.retrievalAssetIds.length > 0
      ? ` | [대차회수대상] 자산 #${dData.retrievalAssetIds.join(', #')}`
      : '';
    const paidByMemo = dData.paidBy
      ? ` | [운송비부담] ${dData.paidBy === 'CUSTOMER' ? '고객청구' : dData.paidBy === 'OURS' ? '당사부담' : '편도지원'}`
      : '';

    const defaultYard = currentTenant?.yards?.find((y: any) => y.isDefault) || currentTenant?.yards?.[0];
    const defaultYardAddress = defaultYard?.address || currentTenant?.mainYardAddress || currentTenant?.businessAddress || '당사 보관소';

    const createdDelivery = db.insertRow<Delivery>('deliveries', {
      contractId: contract.id,
      type: isExchangeDelivery ? 'EXCHANGE' : 'OUTBOUND',
      dispatchCategory: isExchangeDelivery ? '교환' : '출고',
      status: 'REQUESTED',
      requestDate: contract.startDate,
      scheduledDate: loadingDateStr,
      loadingDate: loadingDateStr,
      loadingTimeSlot: loadingTimeSlotStr,
      unloadingDate: unloadingDateStr,
      unloadingTimeSlot: unloadingTimeSlotStr,
      originAddress: dData.originAddress || defaultYardAddress,
      destinationAddress: `${finalCustomer.name} (${finalSite.name} - ${finalSite.address || ''})`,
      transportCompany: '',
      vehicleType: dData.vehicleType || '5T',
      vehicleNo: '',
      driverName: '',
      driverContact: '',
      deliveryCost: 0,
      expectedCost: 0,
      finalCost: 0,
      billableToCustomer: isCustomerPaid,
      billableCustomerId: isCustomerPaid ? finalCustomer.id : undefined,
      reconciliationStatus: 'PENDING',
      cargoItems,
      isCostSettled: false,
      rawText: (data as any).prompt || (data as any).rawText || data.note || '',
      memo: `[스마트출고] 현장담당: ${data.siteContactName || '-'} (${data.siteContactPhone || '-'}) | 상차: ${data.loadingTime || '-'} / 하차: ${data.unloadingTime || '-'}${retrievalMemo}${paidByMemo} | 청구담당: ${data.billingContactName || '-'} (${data.billingContactPhone || '-'}) | 계산서: ${data.taxBillEmail || '-'} | 특이사항: ${data.note || '없음'}`,
      closingMemo: `[마감조건] 마감일: ${dData.closingDay || '-'} / 결제일: ${dData.paymentDay || '-'} | 유상옵션: ${dData.paidOptions || '없음'} | 보양: ${dData.protection || '없음'}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await notify('🌐 Supabase 원격 DB 최종 2차 동기화 완료 중...', 96);

    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error('Supabase sync error during saveSmartDispatch:', err);
      
      // 💥 DB 저장 실패 시 생성되었던 임시 계약/배차/슬롯/이력 레코드 롤백 삭제!
      if (contract?.id) {
        db.deleteRow('contracts', contract.id);
        const addedCAssets = db.contractAssets.filter(ca => ca.contractId === contract.id);
        addedCAssets.forEach(ca => db.deleteRow('contractAssets', ca.id));
        const addedDeliveries = db.deliveries.filter(d => d.contractId === contract.id);
        addedDeliveries.forEach(d => db.deleteRow('deliveries', d.id));
        const addedHistories = db.contractHistory.filter(h => h.contractId === contract.id);
        addedHistories.forEach(h => db.deleteRow('contractHistory', h.id));
        // ✅ 고아 레코드 방지: 롤백 시 생성된 outboundInspections도 함께 삭제
        const addedInspections = db.outboundInspections.filter(i => i.contractId === contract.id);
        addedInspections.forEach(i => db.deleteRow('outboundInspections', i.id));
      }
      refreshAllData();

      const errorMsg = `⚠️ Supabase 데이터베이스 동기화 중 오류가 발생했습니다:\n\n■ [안내]: 저장 실패로 인해 생성 시도했던 데이터가 안전하게 자동 롤백 원복되었습니다.\n\n${err.message || err.details || JSON.stringify(err)}`;
      showErrorModal(errorMsg, '스마트 출고 DB 동기화 오류 (자동 원복 완료)');
      return { 
        success: false, 
        errorMessage: errorMsg
      };
    }

    await notify('🎉 [완료] 출고의뢰 생성을 성공적으로 완료하였습니다!', 100, 300);

    refreshAllData();

    // 🚀 [단일 업무 인계 파이프라인] 배차팀에 물리 ToDo 영구 적재 + 실시간 브로드캐스트
    const totalEqCount = (data.equipments || []).reduce((acc: number, eq: any) => acc + (Number(eq.qty) || 1), 0);
    await issueHandoverTask({
      category: 'DISPATCH_REQUEST',
      title: `[출고 배차 의뢰] ${data.customerName || '고객사'} (${totalEqCount}대)`,
      content: `${data.customerName || '고객사'} (${data.siteName || '현장'}) ${totalEqCount}대 출고 배차 요청 (상차: ${data.loadingTime || '미정'}, 하차: ${data.unloadingTime || '미정'})`,
      targetDept: 'DISPATCH',
      priority: 'HIGH',
      actionUrl: `/admin/dispatch?contractId=${contract.id}`,
      entityType: 'DELIVERY',
      entityId: createdDelivery.id,
      senderId: currentUser?.id,
      senderName: currentUser?.name
    });

    return { success: true, contractId: contract.id, contractNo: contract.contractNo };
  };

  const saveSmartReturn = async (data: SmartReturnData) => {
    try {
      if (data.contractId) {
        const contract = db.contracts.find(c => c.id === data.contractId);
        if (!contract) return { success: false, errorMessage: '계약 정보를 찾을 수 없습니다.' };

        // 새로운 고객담당자(처음 등장하는 사람)라면 자동 등록!
        if (data.contactName) {
          const existingContact = db.contacts.find(ct => ct.customerId === contract.customerId && ct.name.replace(/\s/g, '') === data.contactName!.replace(/\s/g, ''));
          if (!existingContact) {
            db.insertRow<CustomerContact>('contacts', {
              customerId: contract.customerId,
              name: data.contactName,
              position: '담당자',
              contact: data.contactPhone || '미상',
              email: '미상',
              createdAt: new Date().toISOString()
            });
          }
        }

        // 💡 헌장 1.2 & 1.3 준수:
        // 회수 배차 의뢰 단계에서는 현장 장비의 실제 가동 상태를 조기 종료하거나 RENTED_RETURNED로 바꾸지 않음.
        // 자산 상태는 실제 운송 및 입고 검수가 완료되는 시점에 전환됨.
        // 다만 의뢰 이력 관리를 위해 contractHistory에 회수 의뢰 접수 이력만 기록.
        db.insertRow<ContractHistory>('contractHistory', {
          contractId: data.contractId,
          changeType: 'SHORTEN',
          changeDate: new Date().toISOString().split('T')[0],
          prevEndDate: contract.endDate,
          newEndDate: data.returnDate,
          description: `스마트 회수 의뢰 접수 (회수 대상: ${data.assetIds.length}대, 희망일: ${data.returnDate})`,
          createdAt: new Date().toISOString()
        });

        const contactInfoMemo = data.contactName || data.contactPhone
          ? `[고객담당자: ${data.contactName || '-'} (${data.contactPhone || '-'})] `
          : '';
        const cust = db.customers.find(c => c.id === contract.customerId);
        const site = db.sites.find(s => s.id === contract.siteId);
        const returnAssets = db.assets.filter(a => data.assetIds.includes(a.id));
        const modelCountsMap: Record<string, number> = {};
        returnAssets.forEach(a => {
          modelCountsMap[a.modelName] = (modelCountsMap[a.modelName] || 0) + 1;
        });
        const cargoItems = JSON.stringify(Object.entries(modelCountsMap).map(([modelName, count]) => ({ modelName, count })));

        const createdReturnDelivery = db.insertRow<Delivery>('deliveries', {
          contractId: data.contractId,
          assetIds: data.assetIds.join(','),
          type: 'INBOUND',
          dispatchCategory: '입고',
          status: 'REQUESTED',
          requestDate: data.returnDate,
          loadingDate: data.returnDate,
          loadingTimeSlot: data.loadingTime || '오전',
          scheduledDate: data.returnDate,
          unloadingDate: data.returnDate,
          unloadingTimeSlot: data.loadingTime || '오전',
          originAddress: `${cust?.name || '고객사'} (${site?.name || '현장'})`,
          destinationAddress: '당사 보관소',
          transportCompany: '',
          vehicleType: '',
          vehicleNo: '',
          driverName: '',
          driverContact: '',
          deliveryCost: 0,
          expectedCost: 0,
          finalCost: 0,
          reconciliationStatus: 'PENDING',
          cargoItems,
          isCostSettled: false,
          memo: `${contactInfoMemo}${data.note || ''}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        // 🚀 [단일 업무 인계 파이프라인] 배차팀에 회수 배차 ToDo 영구 적재
        const retCount = data.assetIds?.length || 1;
        await issueHandoverTask({
          category: 'DISPATCH_REQUEST',
          title: `[회수 배차 의뢰] ${cust?.name || '고객사'} (${retCount}대)`,
          content: `${cust?.name || '고객사'} (${site?.name || '현장'}) ${retCount}대 회수 배차 요청 (요청일: ${data.returnDate})`,
          targetDept: 'DISPATCH',
          priority: 'HIGH',
          actionUrl: '/admin/dispatch',
          entityType: 'DELIVERY',
          entityId: createdReturnDelivery.id,
          senderId: currentUser?.id,
          senderName: currentUser?.name
        });
      } else {
        // Case 4: 외주정비 회수
        const createdRepairReturnDelivery = db.insertRow<Delivery>('deliveries', {
          assetIds: data.assetIds.join(','),
          type: 'INBOUND',
          dispatchCategory: '입고',
          status: 'REQUESTED',
          requestDate: data.returnDate,
          loadingDate: data.returnDate,
          loadingTimeSlot: data.loadingTime || '오전',
          scheduledDate: data.returnDate,
          unloadingDate: data.returnDate,
          unloadingTimeSlot: data.loadingTime || '오전',
          originAddress: '외주정비업체',
          destinationAddress: '당사 보관소',
          transportCompany: '',
          vehicleType: '',
          vehicleNo: '',
          driverName: '',
          driverContact: '',
          deliveryCost: 0,
          isCostSettled: false,
          memo: `[외주정비회수] 정비건: ${data.repairId || '-'} / 외주업체: ${data.vendorId || '-'} | ${data.note || ''}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        await issueHandoverTask({
          category: 'DISPATCH_REQUEST',
          title: `[외주정비 회수 배차] 장비 ${data.assetIds.length}대`,
          content: `외주정비업체 회수 배차 요청 (정비건: ${data.repairId || '-'}, 외주: ${data.vendorId || '-'})`,
          targetDept: 'DISPATCH',
          priority: 'NORMAL',
          actionUrl: '/admin/dispatch',
          entityType: 'DELIVERY',
          entityId: createdRepairReturnDelivery.id,
          senderId: currentUser?.id,
          senderName: currentUser?.name
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();

      return { success: true };
    } catch (err: any) {
      console.error('saveSmartReturn error:', err);
      showErrorModal(`회수 의뢰 저장 실패:\n${err?.message || err}`);
      return { success: false, errorMessage: err?.message || String(err) };
    }
  };

  const completeTodo = (todoId: string) => {
    const nowIso = new Date().toISOString();
    db.updateRow<Todo>('todos', todoId, { 
      isCompleted: true,
      completedAt: nowIso,
      completedByUserId: currentUser?.id,
      completedByName: currentUser?.name,
      completionAction: 'MANUAL_COMPLETED',
      updatedAt: nowIso
    });
    refreshAllData();
  };

  const issueExecutiveDirective = async (params: {
    targetType: 'USER' | 'DEPT';
    targetUserId?: string;
    targetDept?: string;
    title: string;
    content: string;
    priority?: 'URGENT' | 'HIGH' | 'NORMAL';
    dueDate?: string;
    actionUrl?: string;
  }): Promise<Todo> => {
    const userRole = (currentUser?.role || '').toUpperCase();
    const userDept = (currentUser?.department || '').toUpperCase();
    const isAuthorized = userRole === 'ADMIN' || userRole === 'EXECUTIVE' || userRole === 'MANAGER' || userDept.includes('경영') || userDept.includes('대표');
    if (!isAuthorized) {
      throw new Error('경영진 업무지시 발행 권한이 없습니다. (관리자/경영진 전용)');
    }

    const newTodo = await issueHandoverTask({
      category: 'EXECUTIVE_DIRECTIVE',
      title: params.title,
      content: params.content,
      priority: params.priority || 'URGENT',
      targetType: params.targetType,
      targetDept: params.targetType === 'DEPT' ? params.targetDept : undefined,
      assignedUserId: params.targetType === 'USER' ? params.targetUserId : undefined,
      dueDate: params.dueDate,
      actionUrl: params.actionUrl || '/',
      entityType: 'DIRECTIVE',
      entityId: `DIR-${Date.now()}`,
      senderId: currentUser?.id,
      senderName: currentUser?.name || '경영진'
    });

    await db.awaitPendingWrites();
    refreshAllData();
    return newTodo;
  };

  const resolveExecutiveDirective = async (todoId: string, resolutionNote: string) => {
    const targetTodo = db.todos.find(t => t.id === todoId);
    if (!targetTodo) return;

    const nowIso = new Date().toISOString();
    db.updateRow<Todo>('todos', todoId, {
      isCompleted: true,
      completedAt: nowIso,
      completedByUserId: currentUser?.id,
      completedByName: currentUser?.name,
      completionAction: 'DIRECTIVE_RESOLVED',
      resolutionNote: resolutionNote,
      updatedAt: nowIso
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const cancelExecutiveDirective = async (todoId: string) => {
    const targetTodo = db.todos.find(t => t.id === todoId);
    if (!targetTodo) return;

    const nowIso = new Date().toISOString();
    db.updateRow<Todo>('todos', todoId, {
      isCompleted: true,
      completedAt: nowIso,
      completedByUserId: currentUser?.id,
      completedByName: currentUser?.name,
      completionAction: 'DIRECTIVE_CANCELLED',
      updatedAt: nowIso
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 💡 매입처 거래액 및 거래개시일 자동 트리거 갱신 헬퍼
  const triggerVendorPurchaseMetric = (vendorIdOrName: string, purchaseAmount: number, tradeDate?: string) => {
    if (!vendorIdOrName || !purchaseAmount) return;
    const targetVendor = db.vendors.find(v => 
      v.id === vendorIdOrName || 
      v.name === vendorIdOrName || 
      (v.name && (v.name.includes(vendorIdOrName) || vendorIdOrName.includes(v.name)))
    );
    if (!targetVendor) return;

    const currentTotal = targetVendor.totalPurchaseAmount || 0;
    const newTotal = currentTotal + purchaseAmount;
    const actualDate = tradeDate || new Date().toISOString().split('T')[0];
    const newFirstDate = !targetVendor.firstTradeDate || actualDate < targetVendor.firstTradeDate 
      ? actualDate 
      : targetVendor.firstTradeDate;
    const newLastDate = !targetVendor.lastTradeDate || actualDate > targetVendor.lastTradeDate 
      ? actualDate 
      : targetVendor.lastTradeDate;

    db.updateRow<Vendor>('vendors', targetVendor.id, {
      totalPurchaseAmount: newTotal,
      firstTradeDate: newFirstDate,
      lastTradeDate: newLastDate,
      updatedAt: new Date().toISOString()
    } as any);
  };

  const acquireAsset = async (assetData: Partial<Asset>): Promise<Asset> => {
    const residualRate = assetData.residualValueRate ?? 10;
    const price = assetData.acquisitionPrice ?? 0;
    const bookVal = price;
    
    const newAsset = db.insertRow<Asset>('assets', {
      modelName: assetData.modelName || '',
      assetNo: assetData.assetNo || '',
      serialNo: assetData.serialNo || '',
      manufacturer: assetData.manufacturer || '',
      manufactureYear: assetData.manufactureYear || '',
      ownerType: 'OWNED',
      status: 'AVAILABLE',
      monthlyRentalFee: assetData.monthlyRentalFee || 0,
      dailyRentalFee: assetData.dailyRentalFee || 0,
      acquisitionDate: assetData.acquisitionDate || new Date().toISOString().split('T')[0],
      acquisitionPrice: price,
      depreciationMonths: assetData.depreciationMonths || 96,
      residualValueRate: residualRate,
      accumDepreciation: 0,
      bookValue: bookVal,
      cumRentalFee: 0,
      cumRepairCost: 0,
      vendorId: assetData.vendorId || '',
      supplier: assetData.supplier || '',
      safetyInspectionUrl: assetData.safetyInspectionUrl || '',
      memo1: assetData.memo1 || '',
      memo2: assetData.memo2 || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // 헌장 1.2 사건 기록 무누락 DB 저장: 취득 이벤트 감사 로그
    db.insertRow<AssetInOutLog>('assetInOutLogs', {
      assetId: newAsset.id,
      assetNo: newAsset.assetNo,
      modelName: newAsset.modelName,
      type: 'ACQUISITION',
      eventDate: newAsset.acquisitionDate || new Date().toISOString().split('T')[0],
      memo: `신규 당사자산 취득 등록 (취득가: ${(price || 0).toLocaleString()}원 / 공급처: ${newAsset.supplier || '-'})`,
      createdAt: new Date().toISOString()
    });

    // 💡 매입처 누적거래액 및 거래개시일 자동 트리거 갱신
    triggerVendorPurchaseMetric(newAsset.vendorId || newAsset.supplier || '', price, newAsset.acquisitionDate);

    await db.awaitPendingWrites(); // 💡 헌장 5.2 동기 쓰기 대기
    refreshAllData();
    return newAsset;
  };

  const batchAcquireAssets = async (assetsData: Partial<Asset>[]): Promise<Asset[]> => {
    const createdList: Asset[] = [];
    for (const assetData of assetsData) {
      const residualRate = assetData.residualValueRate ?? 10;
      const price = assetData.acquisitionPrice ?? 0;
      const bookVal = price;
      
      const newAsset = db.insertRow<Asset>('assets', {
        modelName: assetData.modelName || '',
        assetNo: assetData.assetNo || '',
        serialNo: assetData.serialNo || '',
        manufacturer: assetData.manufacturer || '',
        manufactureYear: assetData.manufactureYear || '',
        ownerType: 'OWNED',
        status: 'AVAILABLE',
        monthlyRentalFee: assetData.monthlyRentalFee || 0,
        dailyRentalFee: assetData.dailyRentalFee || 0,
        acquisitionDate: assetData.acquisitionDate || new Date().toISOString().split('T')[0],
        acquisitionPrice: price,
        depreciationMonths: assetData.depreciationMonths || 96,
        residualValueRate: residualRate,
        accumDepreciation: 0,
        bookValue: bookVal,
        cumRentalFee: 0,
        cumRepairCost: 0,
        vendorId: assetData.vendorId || '',
        supplier: assetData.supplier || '',
        safetyInspectionUrl: assetData.safetyInspectionUrl || '',
        memo1: assetData.memo1 || '',
        memo2: assetData.memo2 || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      db.insertRow<AssetInOutLog>('assetInOutLogs', {
        assetId: newAsset.id,
        assetNo: newAsset.assetNo,
        modelName: newAsset.modelName,
        type: 'ACQUISITION',
        eventDate: newAsset.acquisitionDate || new Date().toISOString().split('T')[0],
        memo: `신규 당사자산 취득 등록 [일괄] (취득가: ${(price || 0).toLocaleString()}원 / 공급처: ${newAsset.supplier || '-'})`,
        createdAt: new Date().toISOString()
      });

      // 💡 매입처 누적거래액 및 거래개시일 자동 트리거 갱신
      triggerVendorPurchaseMetric(newAsset.vendorId || newAsset.supplier || '', price, newAsset.acquisitionDate);

      createdList.push(newAsset);
    }
    await db.awaitPendingWrites(); // 💡 헌장 5.2 동기 쓰기 대기
    refreshAllData();
    return createdList;
  };

  // 자산 매각 계약번호 전용 채번기 (SALE-YYYYMMDD-NNN)
  const generateNextSaleContractNo = (): string => {
    const todayYmd = new Date().toISOString().split('T')[0].replace(/-/g, '');
    let maxSeq = 0;
    db.contracts.forEach(c => {
      if (c?.contractType === 'SALE' && c.contractNo?.startsWith(`SALE-${todayYmd}-`)) {
        const parts = c.contractNo.split('-');
        const seq = parseInt(parts[2], 10);
        if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
    return `SALE-${todayYmd}-${String(maxSeq + 1).padStart(3, '0')}`;
  };

  // 💡 자산 매각 계약 체결 & 청구서 발행 & 이메일 발송 5단계 논스톱 완결 파이프라인
  const executeAssetSale = async (payload: AssetSalePayload): Promise<{ success: boolean; contractId: string; billingId: string; contractNo: string }> => {
    try {
      if (!payload.items || payload.items.length === 0) {
        throw new Error('매각 대상 자산이 1대 이상 선택되어야 합니다.');
      }
      if (!payload.disposalDate) {
        throw new Error('매각 일자가 지정되지 않았습니다.');
      }

      // 1. 매수처 고객사 확인 또는 신규 등록
      let customer: Customer | undefined;
      if (payload.customerId) {
        customer = db.customers.find(c => c.id === payload.customerId);
      }
      if (!customer && payload.buyerName) {
        customer = db.customers.find(c => c.name.trim().toLowerCase() === payload.buyerName.trim().toLowerCase());
      }
      if (!customer) {
        customer = db.insertRow<Customer>('customers', {
          name: payload.buyerName || '자산매수처(미상)',
          bizRegNo: payload.buyerBizRegNo || '',
          isClosed: false,
          address: payload.buyerAddress || '',
          representative: payload.buyerRepresentative || '',
          repContact: payload.buyerContact || '',
          repEmail: payload.recipientEmail || '',
          transactionStatus: 'ALLOWED',
          createdAt: new Date().toISOString()
        });
      }

      // 2. 매각 계약번호 및 기본 청구월 책정
      const contractNo = generateNextSaleContractNo();
      const billingYm = payload.disposalDate.slice(0, 7);
      const dayNum = parseInt(payload.disposalDate.slice(8, 10), 10) || 30;

      // 3. 헌장 2.1 & 2.2: 매각 계약(Sale Contract) 생성 (5대 계약 조건 포함)
      const contract = db.insertRow<Contract>('contracts', {
        contractNo,
        contractType: 'SALE',
        saleTerms: payload.saleTerms,
        customerId: customer.id,
        salespersonId: payload.salespersonId || '',
        startDate: payload.disposalDate,
        endDate: payload.disposalDate,
        billingDay: dayNum,
        paymentDueDay: 25,
        lateInterestRate: 0,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      let totalSalePrice = 0;
      const soldAssetSummaries: { assetNo: string; modelName: string; salePrice: number; bookValue: number; gainLoss: number }[] = [];

      // 4. 각 자산별 체결 자산 슬롯 바인딩 및 마스터 SOLD 전이
      for (const item of payload.items) {
        const asset = db.assets.find(a => a.id === item.assetId);
        if (!asset) continue;

        const salePrice = Math.max(0, Number(item.salePrice) || 0);
        totalSalePrice += salePrice;

        const dep = calculateAssetDepreciation(asset, new Date(payload.disposalDate));
        const bookVal = dep.bookValue;
        const gainLoss = salePrice - bookVal;

        soldAssetSummaries.push({
          assetNo: asset.assetNo,
          modelName: asset.modelName,
          salePrice,
          bookValue: bookVal,
          gainLoss
        });

        // 4-1. 체결 자산 슬롯 추가
        const ca = db.insertRow<ContractAsset>('contractAssets', {
          contractId: contract.id,
          assetId: asset.id,
          expectedModel: asset.modelName,
          status: 'SOLD',
          monthlyRentalFee: 0,
          dailyRentalFee: 0,
          salePrice,
          startDate: payload.disposalDate,
          endDate: payload.disposalDate,
          createdAt: new Date().toISOString()
        });

        // 4-2. 자산 마스터 SOLD 전이 및 처분 스냅샷 반영
        db.updateRow<Asset>('assets', asset.id, {
          status: 'SOLD',
          disposalDate: payload.disposalDate,
          disposalPrice: salePrice,
          buyer: customer.name,
          currentCustomerId: customer.id,
          monthlyRentalFee: 0,
          dailyRentalFee: 0,
          updatedAt: new Date().toISOString()
        });

        // 4-3. 헌장 1.2 무누락 DB 저장: 자산 입출고 이력(DISPOSAL) 영구 기록
        db.insertRow<AssetInOutLog>('assetInOutLogs', {
          assetId: asset.id,
          assetNo: asset.assetNo,
          modelName: asset.modelName,
          type: 'DISPOSAL',
          customerId: customer.id,
          customerName: customer.name,
          eventDate: payload.disposalDate,
          memo: `자산 매각 처분 계약 체결 (계약: ${contract.contractNo}, 매각단가: ₩${salePrice.toLocaleString()}, 처분손익: ₩${gainLoss.toLocaleString()})`,
          createdAt: new Date().toISOString()
        });
      }

      // 5. 1회성 매각 청구서(billings) 및 상세(billingDetails) 발행 (과세 10% 분리, 총액 100% 일치)
      const vat = Math.round(totalSalePrice * 0.1);
      const grandTotal = totalSalePrice + vat;

      const billing = db.insertRow<Billing>('billings', {
        billingType: 'ASSET_SALE',
        customerId: customer.id,
        contractId: contract.id,
        billingYm,
        billingDate: payload.disposalDate,
        totalAmount: grandTotal, // 💡 공급가 + 부가세 10% 총액 일치 (BankMatching 1원 오차 방지)
        paidAmount: 0,
        status: 'REQUESTED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      for (const summary of soldAssetSummaries) {
        db.insertRow<BillingDetail>('billingDetails', {
          billingId: billing.id,
          itemName: `[자산매각] ${summary.modelName} (관리번호: ${summary.assetNo})`,
          quantity: 1,
          unitPrice: summary.salePrice,
          amount: summary.salePrice,
          internalDescription: `운영 자산 매각 대금 청구 (계약: ${contract.contractNo})`,
          displayName: `${summary.modelName} 매각대금`,
          createdAt: new Date().toISOString()
        });
      }

      // 6. 계약 이력(contractHistory) 기록
      db.insertRow<ContractHistory>('contractHistory', {
        contractId: contract.id,
        changeType: 'ASSET_SOLD',
        changeDate: payload.disposalDate,
        description: `운영 자산 ${soldAssetSummaries.length}대 매각 처분 계약 체결 (매각총액: ₩${totalSalePrice.toLocaleString()})`,
        createdAt: new Date().toISOString()
      });

      // 🚀 [단일 업무 인계 파이프라인] 주기장에 매각 장비 실물 인도 검수 ToDo 발행
      await issueHandoverTask({
        category: 'ASSET_DISPOSAL_HANDOVER',
        title: `[매각 장비 인도 검수] ${customer.name} (${soldAssetSummaries.length}대)`,
        content: `매각 처분 계약 체결 완료 (계약: ${contract.contractNo}, 총액: ₩${grandTotal.toLocaleString()}). 주기장 실물 인도 및 상차 검수를 진행하세요.`,
        targetDept: 'YARD',
        priority: 'HIGH',
        actionUrl: '/admin/asset_acquisition_disposal',
        entityType: 'CONTRACT',
        entityId: contract.id,
        senderId: currentUser?.id,
        senderName: currentUser?.name
      });

      // 7. 헌장 5.2 동기 쓰기 대기
      await db.awaitPendingWrites();

      // 8. 이메일 발송 연동 (요청된 경우)
      if (payload.sendEmail && payload.recipientEmail) {
        try {
          const vat = Math.round(totalSalePrice * 0.1);
          const grand = totalSalePrice + vat;
          const tenantBrand = currentTenant?.displayName || currentTenant?.tradeName || 'e-Bro';
          const tenantCorp = currentTenant?.tradeName || currentTenant?.corporateName || tenantBrand;
          const tenantAccount = currentTenant?.bankAccounts?.[0]
            ? `[${tenantBrand}] ${currentTenant.bankAccounts[0].bankName} ${currentTenant.bankAccounts[0].accountNumber} (예금주: ${currentTenant.bankAccounts[0].accountHolder})`
            : '[e-Bro] 계좌문의';
          const subject = `[${tenantBrand}] 자산 매각 계약서 및 청구서 안내 (${customer.name} 귀하)`;
          const paymentTermsText = payload.saleTerms?.paymentType === 'INSTALLMENT'
            ? `분할 지급 (계약금: ₩${(payload.saleTerms.installmentDownAmount || 0).toLocaleString()}원 / 잔금: ₩${(payload.saleTerms.installmentBalanceAmount || 0).toLocaleString()}원, 잔금납기: ${payload.saleTerms.installmentBalanceDueDate || '-'})`
            : `일시불 완납 (${payload.saleTerms?.lumpSumDueTerm === 'DELIVERY' ? '장비 인도일 완납' : payload.saleTerms?.lumpSumDueTerm === '7_DAYS' ? '계약일로부터 7일 이내' : payload.saleTerms?.lumpSumDueTerm === '14_DAYS' ? '계약일로부터 14일 이내' : payload.saleTerms?.lumpSumDueTerm === 'MONTH_10' ? '익월 10일 완납' : '계약 체결 즉시 완납'})`;

          const deliveryTermsText = `${payload.saleTerms?.deliveryLocationType === 'BUYER_SITE' ? '매수처 지정지 하차도' : '당사 주기장 상차도(FOB)'} (${payload.saleTerms?.freightBearer === 'SELLER' ? '당사 운송부담' : '매수자 운송부담'}) / 인도예정일: ${payload.saleTerms?.deliveryDate || payload.disposalDate}`;

          const body = `
안녕하세요, ${customer.name} 담당자님.
${tenantCorp}입니다.

귀사와 체결된 고소작업대 자산 매각 계약 건에 대한 계약서 및 매각 대금 청구 내역을 안내해 드립니다.

[계약 및 청구 요약]
- 계약번호: ${contract.contractNo}
- 계약유형: 자산 매각 계약
- 양도일자: ${payload.disposalDate}
- 매각 수량: 총 ${soldAssetSummaries.length}대
- 공급가액: ₩${totalSalePrice.toLocaleString()}원
- 부가세 (10%): ₩${vat.toLocaleString()}원
- 청구 총합계금액: ₩${grand.toLocaleString()}원
- 입금 계좌: ${payload.saleTerms?.bankAccount ? payload.saleTerms.bankAccount : tenantAccount}
- 결제 조건: ${paymentTermsText}
- 인도 조건: ${deliveryTermsText}
${payload.saleTerms?.useStandardAsIsClause ? '- 특약: 현상태 인수(As-Is) 및 소유권 유보(대금 완납 시 이전)\n' : ''}
[매각 장비 상세 내역]
${soldAssetSummaries.map((s, idx) => `${idx + 1}. 관리번호: ${s.assetNo} / 모델명: ${s.modelName} / 매각단가: ₩${s.salePrice.toLocaleString()}원`).join('\n')}

${payload.memo ? `\n[특이사항 / 메모]\n${payload.memo}\n` : ''}

감사합니다.
${currentTenant?.corporateName || tenantCorp} 배상
          `.trim();

          await emailService.sendEmail(
            payload.recipientEmail,
            subject,
            body,
            [],
            payload.ccEmail
          );

          db.insertRow<ContractHistory>('contractHistory', {
            contractId: contract.id,
            changeType: 'DOCUMENT_SENT',
            changeDate: payload.disposalDate,
            description: `자산 매각 계약서 및 청구 내역 이메일 발송 완료 (수신: ${payload.recipientEmail})`,
            createdAt: new Date().toISOString()
          });
          await db.awaitPendingWrites();
        } catch (mailErr: any) {
          console.warn('[executeAssetSale] 이메일 발송 실패 (계약 및 청구는 정상 보존됨):', mailErr);
        }
      }

      refreshAllData();
      return { success: true, contractId: contract.id, billingId: billing.id, contractNo: contract.contractNo };
    } catch (err: any) {
      console.error('[executeAssetSale] Error:', err);
      showErrorModal(`⚠️ 자산 매각 계약 처리 중 오류가 발생했습니다:\n\n${err?.message || err}`, '자산 매각 실패');
      throw err;
    }
  };

  // 구버전 호환용 래퍼
  const disposeAsset = async (assetId: string, disposalData: { disposalDate: string; disposalPrice: number; buyer: string; billingYm?: string }) => {
    return executeAssetSale({
      buyerName: disposalData.buyer,
      disposalDate: disposalData.disposalDate,
      items: [{ assetId, salePrice: disposalData.disposalPrice }]
    });
  };

  const registerRentedAsset = async (assetData: Partial<Asset>) => {
    let result;
    const sanitizedMonthlyFee = Math.max(0, Number(assetData.monthlyRentFee) || 0);
    const sanitizedDailyFee = assetData.dailyRentFee ? Math.max(0, Number(assetData.dailyRentFee)) : Math.floor(sanitizedMonthlyFee / 30);

    const existing = db.assets.find(a => a.assetNo === assetData.assetNo || (assetData.id && a.id === assetData.id));
    if (existing) {
      result = db.updateRow<Asset>('assets', existing.id, {
        ...assetData,
        vendorAssetNo: assetData.vendorAssetNo || existing.vendorAssetNo || '',
        ownerType: 'RENTED',
        status: 'AVAILABLE',
        monthlyRentFee: sanitizedMonthlyFee,
        dailyRentFee: sanitizedDailyFee,
        actualRentReturnDate: '', // 과거 실제 반납일 초기화 (재임차 활성화)
        updatedAt: new Date().toISOString()
      });
    } else {
      result = db.insertRow<Asset>('assets', {
        modelName: assetData.modelName || '',
        assetNo: assetData.assetNo || '',
        vendorAssetNo: assetData.vendorAssetNo || '',
        serialNo: assetData.serialNo || '',
        manufacturer: assetData.manufacturer || '',
        ownerType: 'RENTED',
        status: 'AVAILABLE',
        renter: assetData.renter || '',
        rentStart: assetData.rentStart || '',
        rentEnd: assetData.rentEnd || '',
        monthlyRentFee: sanitizedMonthlyFee,
        dailyRentFee: sanitizedDailyFee,
        acquisitionPrice: 0,
        depreciationMonths: 0,
        residualValueRate: 0,
        accumDepreciation: 0,
        bookValue: 0,
        cumRentalFee: 0,
        cumRepairCost: 0,
        memo1: assetData.memo1 || '',
        memo2: assetData.memo2 || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }
    // 헌장 1.2 무누락 감사 로그: 임차처 임차 반입
    if (result) {
      db.insertRow<AssetInOutLog>('assetInOutLogs', {
        assetId: result.id,
        assetNo: result.assetNo,
        modelName: result.modelName,
        type: 'INBOUND',
        eventDate: result.rentStart || new Date().toISOString().split('T')[0],
        memo: `[임차 반입] 임차처: ${result.renter || '임차처'} (임차처번호: ${result.vendorAssetNo || '-'})`,
        createdAt: new Date().toISOString()
      });
    }

    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error('registerRentedAsset Supabase sync error:', err);
      showErrorModal(`⚠️ 임차 자산 저장 중 원격 DB 동기화 오류가 발생했습니다:\n${err.message || err.details || JSON.stringify(err)}`, 'DB 동기화 오류');
      throw err;
    }
    refreshAllData();
    return result;
  };

  const returnRentedAsset = async (assetId: string, returnDate: string, options?: { isDirectReturn?: boolean; memo?: string }): Promise<void> => {
    const target = db.assets.find(a => a.id === assetId);
    if (!target) return;

    if (target.rentStart && returnDate < target.rentStart) {
      showErrorModal(`⚠️ 임차처 반납일(${returnDate})은 임차 시작일(${target.rentStart}) 이전일 수 없습니다.`);
      throw new Error(`임차처 반납일이 임차 시작일 이전입니다.`);
    }

    const isDirect = options?.isDirectReturn || target.status === 'RENTED';
    const cust = db.customers.find(c => c.id === target.currentCustomerId);
    const site = db.sites.find(s => s.id === target.currentSiteId);

    try {
      db.updateRow<Asset>('assets', assetId, {
        status: 'RENTED_RETURNED',
        actualRentReturnDate: returnDate,
        currentCustomerId: '',
        currentSiteId: '',
        contractStart: undefined,
        contractEnd: undefined,
        updatedAt: new Date().toISOString()
      });

      // 헌장 1.2 무누락 감사 로그: 임차처 반납 반출 (사법 감사 판정: type OUTBOUND)
      db.insertRow<AssetInOutLog>('assetInOutLogs', {
        assetId: target.id,
        assetNo: target.assetNo,
        modelName: target.modelName,
        type: 'OUTBOUND',
        customerId: target.currentCustomerId || undefined,
        customerName: cust?.name,
        siteId: target.currentSiteId || undefined,
        siteName: site?.name,
        eventDate: returnDate,
        memo: options?.memo || (isDirect 
          ? `[임차자산 현장 직반납] 고객사(${cust?.name || '-'}) 현장에서 임차처(${target.renter || '임차처'})로 직반납 처리`
          : `[임차자산 주기장 반납] 당사 주기장에서 임차처(${target.renter || '임차처'})로 반납 처리`),
        createdAt: new Date().toISOString()
      });

      // 헌장 5.2 준수: CUD 동기 검증
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('returnRentedAsset 동기화 실패:', err);
      showErrorModal(`⚠️ 임차처 반납 마감 처리 중 DB 동기화 오류가 발생했습니다:\n${err.message || err}`, 'DB 동기화 오류');
      throw err;
    }
  };

  const createVendorClaimReceivable = async (data: {
    contractId?: string;
    customerId?: string;
    vendorName: string;
    assetNo: string;
    totalAmount: number;
    internalDescription: string;
    displayName?: string;
    occurredDate?: string;
  }): Promise<void> => {
    try {
      db.insertRow<Receivable>('receivables', {
        contractId: data.contractId,
        customerId: data.customerId,
        type: 'VENDOR_CLAIM',
        totalAmount: data.totalAmount,
        billedAmount: 0,
        internalDescription: data.internalDescription,
        displayName: data.displayName || data.internalDescription,
        occurredDate: data.occurredDate || new Date().toISOString().split('T')[0],
        vendorName: data.vendorName,
        assetNo: data.assetNo,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('createVendorClaimReceivable error:', err);
      showErrorModal(`⚠️ 구상 미수금 등록 오류:\n${err.message || err.details || JSON.stringify(err)}`, 'DB 동기화 오류');
      throw err;
    }
  };

  const addConsumable = async (data: Omit<Consumable, 'id' | 'createdAt' | 'updatedAt' | 'stockQty'> & { stockQty?: number }) => {
    try {
      db.insertRow<Consumable>('consumables', {
        ...data,
        stockQty: data.stockQty || 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 소모품 품목 등록 오류:\n${err.message || err}`, 'DB 동기화 오류');
      throw err;
    }
  };

  const updateConsumable = async (id: string, updates: Partial<Consumable>) => {
    try {
      db.updateRow<Consumable>('consumables', id, {
        ...updates,
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 소모품 품목 수정 오류:\n${err.message || err}`, 'DB 동기화 오류');
      throw err;
    }
  };

  const deleteConsumable = async (id: string) => {
    try {
      const hasLogs = db.consumableLogs.some(l => l.consumableId === id);
      const hasVehicleStock = db.mechanicConsumableStocks.some(s => s.consumableId === id && s.stockQty > 0);
      
      if (hasLogs || hasVehicleStock) {
        showErrorModal('수불 이력이 있거나 차량에 불출된 재고가 있어 삭제할 수 없습니다. 관리자에게 문의하여 단종 처리하세요.', '삭제 불가');
        throw new Error('삭제 불가');
      }

      db.deleteRow('consumables', id);
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      if (err.message !== '삭제 불가') {
        showErrorModal(`⚠️ 소모품 삭제 오류:\n${err.message || err}`, 'DB 동기화 오류');
      }
      throw err;
    }
  };

  const purchaseConsumable = async (data: { modelName: string; qty: number; unit: string; unitPrice: number; supplier: string }) => {
    if (!data.modelName?.trim()) {
      showErrorModal('소모품 품명을 입력해주세요.');
      return;
    }
    if (data.qty <= 0) {
      showErrorModal('입고 수량은 1개 이상이어야 합니다.');
      return;
    }
    if (data.unitPrice < 0) {
      showErrorModal('단가는 0원 이상이어야 합니다.');
      return;
    }
    const cleanQty = Math.max(1, Math.floor(data.qty));
    const cleanPrice = Math.max(0, Number(data.unitPrice) || 0);

    let consumable = db.consumables.find(c => c.modelName.replace(/\s/g, '') === data.modelName.replace(/\s/g, ''));
    
    if (consumable) {
      db.updateRow<Consumable>('consumables', consumable.id, {
        stockQty: consumable.stockQty + cleanQty,
        unitPrice: cleanPrice,
        supplier: data.supplier,
        updatedAt: new Date().toISOString()
      });
    } else {
      consumable = db.insertRow<Consumable>('consumables', {
        modelName: data.modelName.trim(),
        stockQty: cleanQty,
        unit: data.unit || '개',
        unitPrice: cleanPrice,
        supplier: data.supplier,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    db.insertRow<ConsumableLog>('consumableLogs', {
      consumableId: consumable.id,
      type: 'INBOUND',
      quantity: cleanQty,
      unitPrice: cleanPrice,
      supplier: data.supplier,
      userId: getValidUserId(currentUser?.id),
      actionDate: new Date().toISOString().split('T')[0],
      description: '소모품 구입 입고',
      createdAt: new Date().toISOString()
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const useConsumable = async (data: { consumableId: string; quantity: number; targetAssetId: string; description: string }) => {
    try {
      if (data.quantity <= 0) {
        showErrorModal('소모 수량은 1개 이상이어야 합니다.');
        throw new Error('소모 수량은 1개 이상이어야 합니다.');
      }
      const cleanQty = Math.max(1, Math.floor(data.quantity));
      const consumable = db.consumables.find(c => c.id === data.consumableId);
      if (!consumable || consumable.stockQty < cleanQty) {
        const msg = `소모품 재고가 부족합니다. (현재고: ${consumable?.stockQty || 0}개 / 요청: ${cleanQty}개)`;
        showErrorModal(`⚠️ ${msg}`);
        throw new Error(msg);
      }

      db.updateRow<Consumable>('consumables', consumable.id, {
        stockQty: consumable.stockQty - cleanQty,
        updatedAt: new Date().toISOString()
      });

      db.insertRow<ConsumableLog>('consumableLogs', {
        consumableId: consumable.id,
        type: 'OUTBOUND',
        quantity: cleanQty,
        unitPrice: consumable.unitPrice,
        targetAssetId: data.targetAssetId,
        userId: getValidUserId(currentUser?.id),
        actionDate: new Date().toISOString().split('T')[0],
        description: data.description,
        createdAt: new Date().toISOString()
      });

      const asset = db.assets.find(a => a.id === data.targetAssetId);
      if (asset) {
        const cost = consumable.unitPrice * cleanQty;
        db.updateRow<Asset>('assets', asset.id, {
          cumRepairCost: (asset.cumRepairCost || 0) + cost,
          updatedAt: new Date().toISOString()
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 소모품 사용 처리 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const transferConsumableToMechanic = async (mechanicId: string, consumableId: string, quantity: number, memo?: string): Promise<void> => {
    try {
      if (quantity <= 0) {
        showErrorModal('불출 수량은 1개 이상이어야 합니다.');
        throw new Error('불출 수량은 1개 이상이어야 합니다.');
      }
      const consumable = db.consumables.find(c => c.id === consumableId);
      if (!consumable || consumable.stockQty < quantity) {
        const msg = `본사 재고가 부족합니다. (본사 현재고: ${consumable?.stockQty || 0}개)`;
        showErrorModal(`⚠️ ${msg}`);
        throw new Error(msg);
      }

      const mechanic = db.users.find(u => u.id === mechanicId);
      const mechanicName = mechanic?.name || '정비사';

      // 1. 본사 재고 차감
      db.updateRow<Consumable>('consumables', consumableId, {
        stockQty: consumable.stockQty - quantity,
        updatedAt: new Date().toISOString()
      });

      // 2. 기사 차량 재고 증가
      const existingStock = db.mechanicConsumableStocks.find(s => s.mechanicId === mechanicId && s.consumableId === consumableId);
      if (existingStock) {
        db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', existingStock.id, {
          stockQty: existingStock.stockQty + quantity,
          updatedAt: new Date().toISOString()
        });
      } else {
        const newId = `mcs-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
        db.insertRow<MechanicConsumableStock>('mechanicConsumableStocks', {
          id: newId,
          mechanicId,
          consumableId,
          stockQty: quantity,
          updatedAt: new Date().toISOString()
        });
      }

      // 3. 재고 이동 수불 로그 기록
      db.insertRow<ConsumableLog>('consumableLogs', {
        consumableId,
        type: 'TRANSFER_TO_VEHICLE',
        quantity,
        unitPrice: consumable.unitPrice,
        userId: currentUser?.id,
        mechanicId,
        fromLocation: '주기장 재고',
        toLocation: `${mechanicName} 차량`,
        actionDate: new Date().toISOString().split('T')[0],
        description: memo || `[차량 불출] 주기장 ➔ ${mechanicName} 차량 이동 (${quantity}개)`,
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 차량 불출 처리 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const returnConsumableToHq = async (
    mechanicId: string, 
    consumableId: string, 
    quantity: number, 
    memo?: string,
    isDefective: boolean = false,
    disposition: 'REBUILD' | 'SCRAP' | 'VENDOR_WARRANTY' = 'REBUILD'
  ): Promise<void> => {
    try {
      if (quantity <= 0) {
        showErrorModal('반납 수량은 1개 이상이어야 합니다.');
        throw new Error('반납 수량은 1개 이상이어야 합니다.');
      }
      const existingStock = db.mechanicConsumableStocks.find(s => s.mechanicId === mechanicId && s.consumableId === consumableId);
      if (!existingStock || existingStock.stockQty < quantity) {
        const msg = `차량 보유 재고가 부족합니다. (차량 현재고: ${existingStock?.stockQty || 0}개)`;
        showErrorModal(`⚠️ ${msg}`);
        throw new Error(msg);
      }

      const consumable = db.consumables.find(c => c.id === consumableId);
      const mechanic = db.users.find(u => u.id === mechanicId);
      const mechanicName = mechanic?.name || '정비사';

      // 1. 기사 차량 재고 차감
      db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', existingStock.id, {
        stockQty: existingStock.stockQty - quantity,
        updatedAt: new Date().toISOString()
      });

      // 2. 신품 정상 반납 vs 고품 격리 처리
      if (!isDefective) {
        // 정상 신품 반납: 주기장 가용 재고 증가
        if (consumable) {
          db.updateRow<Consumable>('consumables', consumableId, {
            stockQty: consumable.stockQty + quantity,
            updatedAt: new Date().toISOString()
          });
        }
      } else {
        // 고품(불량품) 반납: 주기장 신품 가용재고 가산 차단 및 고품 관리 대장(collectedParts) 격리 적재
        const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const newPartNo = `COL-${todayStr}-${Math.floor(1000 + Math.random() * 9000)}`;
        db.insertRow<CollectedPart>('collectedParts', {
          id: `col-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          partNo: newPartNo,
          consumableId,
          modelName: consumable?.modelName || '부품',
          mechanicId,
          mechanicName,
          quantity,
          disposition,
          status: 'RECEIVED',
          receivedDate: new Date().toISOString().split('T')[0],
          memo: memo || `[고품 수거] ${mechanicName} 차량 반납 (${disposition})`,
          createdAt: new Date().toISOString()
        });
      }

      // 3. 재고 반납 수불 로그 기록
      db.insertRow<ConsumableLog>('consumableLogs', {
        consumableId,
        type: 'RETURN_TO_HQ',
        quantity,
        unitPrice: consumable?.unitPrice || 0,
        userId: currentUser?.id,
        mechanicId,
        fromLocation: `${mechanicName} 차량`,
        toLocation: !isDefective ? '주기장 재고' : `고품 격리실 (${disposition})`,
        actionDate: new Date().toISOString().split('T')[0],
        description: memo || (!isDefective 
          ? `[주기장 반납] ${mechanicName} 차량 ➔ 주기장 재고 회수 (${quantity}개)`
          : `[고품 반납] ${mechanicName} 차량 ➔ 고품 격리 (${disposition}, ${quantity}개)`),
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 본사 반납 처리 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const transferConsumableBetweenMechanics = async (
    fromMechanicId: string,
    toMechanicId: string,
    consumableId: string,
    quantity: number,
    memo?: string
  ): Promise<void> => {
    try {
      if (fromMechanicId === toMechanicId) {
        showErrorModal('동일한 정비사 차량 간에는 이동할 수 없습니다.');
        throw new Error('동일한 정비사 차량 간에는 이동할 수 없습니다.');
      }
      if (quantity <= 0) {
        showErrorModal('이동 수량은 1개 이상이어야 합니다.');
        throw new Error('이동 수량은 1개 이상이어야 합니다.');
      }

      const fromStock = db.mechanicConsumableStocks.find(s => s.mechanicId === fromMechanicId && s.consumableId === consumableId);
      if (!fromStock || fromStock.stockQty < quantity) {
        const msg = `양도 정비사 차량의 보유 재고가 부족합니다. (현재고: ${fromStock?.stockQty || 0}개)`;
        showErrorModal(`⚠️ ${msg}`);
        throw new Error(msg);
      }

      const fromUser = db.users.find(u => u.id === fromMechanicId);
      const toUser = db.users.find(u => u.id === toMechanicId);
      const consumable = db.consumables.find(c => c.id === consumableId);

      // 1. 양도 차량 재고 차감
      db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', fromStock.id, {
        stockQty: fromStock.stockQty - quantity,
        updatedAt: new Date().toISOString()
      });

      // 2. 양수 차량 재고 증가
      const toStock = db.mechanicConsumableStocks.find(s => s.mechanicId === toMechanicId && s.consumableId === consumableId);
      if (toStock) {
        db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', toStock.id, {
          stockQty: toStock.stockQty + quantity,
          updatedAt: new Date().toISOString()
        });
      } else {
        db.insertRow<MechanicConsumableStock>('mechanicConsumableStocks', {
          id: `mcs-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
          mechanicId: toMechanicId,
          consumableId,
          stockQty: quantity,
          updatedAt: new Date().toISOString()
        });
      }

      // 3. 수불 로그 기록
      db.insertRow<ConsumableLog>('consumableLogs', {
        consumableId,
        type: 'TRANSFER_TO_VEHICLE',
        quantity,
        unitPrice: consumable?.unitPrice || 0,
        userId: currentUser?.id,
        mechanicId: toMechanicId,
        fromLocation: `${fromUser?.name || '정비사'} 차량`,
        toLocation: `${toUser?.name || '정비사'} 차량`,
        actionDate: new Date().toISOString().split('T')[0],
        description: memo || `[차량 간 융통] ${fromUser?.name} 차량 ➔ ${toUser?.name} 차량 (${quantity}개)`,
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 차량 간 부품 융통 처리 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const createStocktakingAudit = async (
    targetType: 'HQ' | 'VEHICLE',
    mechanicId?: string,
    memo?: string
  ): Promise<StocktakingAudit> => {
    try {
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const ymdCompact = dateStr.replace(/-/g, '');
      const auditNo = `STK-${ymdCompact}-${Math.floor(1000 + Math.random() * 9000)}`;

      let mechanicName: string | undefined;
      let vehicleNo: string | undefined;

      if (targetType === 'VEHICLE') {
        if (!mechanicId) throw new Error('차량 실사의 경우 담당 정비사를 지정해야 합니다.');
        const mech = db.users.find(u => u.id === mechanicId);
        mechanicName = mech?.name;
        const corpVehicle = db.corporateVehicles.find(v => v.primaryDriverId === mechanicId);
        vehicleNo = corpVehicle?.vehicleNo || (mech as any)?.vehicleNo || '';
      }

      // 1. 실사 마스터 생성
      const newAuditId = `stk-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
      
      // 2. 당시 전산 재고 스냅샷 생성
      const itemsToInsert: StocktakingAuditItem[] = [];
      let totalSystemQty = 0;
      let totalSystemAmount = 0;

      if (targetType === 'HQ') {
        // 주기장 재고: 전체 consumable 목록 스냅샷
        db.consumables.forEach(c => {
          const sysQty = c.stockQty || 0;
          const uPrice = c.unitPrice || 0;
          totalSystemQty += sysQty;
          totalSystemAmount += sysQty * uPrice;

          itemsToInsert.push({
            id: `stki-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            auditId: newAuditId,
            consumableId: c.id,
            modelName: c.modelName,
            unit: c.unit || '개',
            unitPrice: uPrice,
            systemQty: sysQty,
            actualQty: sysQty,
            diffQty: 0,
            diffAmount: 0
          });
        });
      } else {
        // 특정 정비사 차량: 해당 정비사의 보유 부품 또는 전사 부품 스냅샷
        const mechStocks = db.mechanicConsumableStocks.filter(s => s.mechanicId === mechanicId);
        const stockMap = new Map<string, number>();
        mechStocks.forEach(s => stockMap.set(s.consumableId, s.stockQty || 0));

        db.consumables.forEach(c => {
          const sysQty = stockMap.get(c.id) || 0;
          const uPrice = c.unitPrice || 0;
          totalSystemQty += sysQty;
          totalSystemAmount += sysQty * uPrice;

          itemsToInsert.push({
            id: `stki-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            auditId: newAuditId,
            consumableId: c.id,
            modelName: c.modelName,
            unit: c.unit || '개',
            unitPrice: uPrice,
            systemQty: sysQty,
            actualQty: sysQty,
            diffQty: 0,
            diffAmount: 0
          });
        });
      }

      const newAudit: StocktakingAudit = {
        id: newAuditId,
        auditNo,
        targetType,
        mechanicId,
        mechanicName,
        vehicleNo,
        auditDate: dateStr,
        auditorId: currentUser?.id || 'admin',
        auditorName: currentUser?.name || '실사담당자',
        status: 'DRAFT',
        totalSystemQty,
        totalActualQty: totalSystemQty,
        totalDiffQty: 0,
        totalSystemAmount,
        totalActualAmount: totalSystemAmount,
        totalDiffAmount: 0,
        memo,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      db.insertRow<StocktakingAudit>('stocktakingAudits', newAudit);
      itemsToInsert.forEach(item => {
        db.insertRow<StocktakingAuditItem>('stocktakingAuditItems', item);
      });

      await db.awaitPendingWrites();
      refreshAllData();
      return newAudit;
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 전표 생성 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const updateStocktakingItem = async (
    auditId: string,
    itemId: string,
    actualQty: number,
    diffReason?: StocktakingAuditItem['diffReason'],
    note?: string
  ): Promise<void> => {
    try {
      const item = db.stocktakingAuditItems.find(i => i.id === itemId && i.auditId === auditId);
      if (!item) throw new Error('실사 품목을 찾을 수 없습니다.');

      const clampedActualQty = Math.max(0, actualQty);
      const diffQty = clampedActualQty - item.systemQty;
      const diffAmount = diffQty * item.unitPrice;

      db.updateRow<StocktakingAuditItem>('stocktakingAuditItems', itemId, {
        actualQty: clampedActualQty,
        diffQty,
        diffAmount,
        diffReason: diffQty !== 0 ? (diffReason || item.diffReason || 'OTHER') : undefined,
        note
      });

      // 마스터 합계 갱신
      const allItems = db.stocktakingAuditItems.filter(i => i.auditId === auditId);
      const updatedItems = allItems.map(i => i.id === itemId ? { ...i, actualQty: clampedActualQty, diffQty, diffAmount } : i);
      const totalSystemQty = updatedItems.reduce((acc, i) => acc + (i.systemQty || 0), 0);
      const totalActualQty = updatedItems.reduce((acc, i) => acc + (i.actualQty || 0), 0);
      const totalDiffQty = totalActualQty - totalSystemQty;
      const totalSystemAmount = updatedItems.reduce((acc, i) => acc + ((i.systemQty || 0) * (i.unitPrice || 0)), 0);
      const totalActualAmount = updatedItems.reduce((acc, i) => acc + ((i.actualQty || 0) * (i.unitPrice || 0)), 0);
      const totalDiffAmount = totalActualAmount - totalSystemAmount;

      db.updateRow<StocktakingAudit>('stocktakingAudits', auditId, {
        totalSystemQty,
        totalActualQty,
        totalDiffQty,
        totalSystemAmount,
        totalActualAmount,
        totalDiffAmount,
        updatedAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 품목 수량 수정 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const confirmStocktakingAudit = async (auditId: string): Promise<void> => {
    try {
      const audit = db.stocktakingAudits.find(a => a.id === auditId);
      if (!audit) throw new Error('실사 전표를 찾을 수 없습니다.');
      if (audit.status === 'CONFIRMED') throw new Error('이미 확정 완료된 실사 전표입니다.');

      const items = db.stocktakingAuditItems.filter(i => i.auditId === auditId);
      const targetLocation = audit.targetType === 'HQ' ? '주기장 재고' : `${audit.mechanicName || '정비사'} 차량`;

      // 1. 차이가 있는 품목들에 대해 전산 재고 강제 보정 & ADJUST 수불 로그 발행
      items.forEach(item => {
        if (item.diffQty !== 0) {
          if (audit.targetType === 'HQ') {
            // 본사 창고 전산재고 강제 보정
            const c = db.consumables.find(con => con.id === item.consumableId);
            if (c) {
              db.updateRow<Consumable>('consumables', c.id, {
                stockQty: item.actualQty,
                updatedAt: new Date().toISOString()
              });
            }
          } else {
            // 특정 정비사 차량 전산재고 강제 보정
            const mStock = db.mechanicConsumableStocks.find(s => s.mechanicId === audit.mechanicId && s.consumableId === item.consumableId);
            if (mStock) {
              db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', mStock.id, {
                stockQty: item.actualQty,
                updatedAt: new Date().toISOString()
              });
            } else {
              db.insertRow<MechanicConsumableStock>('mechanicConsumableStocks', {
                id: `mcs-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
                mechanicId: audit.mechanicId!,
                consumableId: item.consumableId,
                stockQty: item.actualQty,
                updatedAt: new Date().toISOString()
              });
            }
          }

          // ADJUST 감사 로그 자동 적재
          const reasonText = item.diffReason === 'LOST' ? '망실/도난' 
            : item.diffReason === 'DAMAGED' ? '파손/폐기'
            : item.diffReason === 'UNRECORDED_USAGE' ? '미기록현장소모'
            : item.diffReason === 'SURPLUS' ? '미등록잉여' : '기타사유';

          db.insertRow<ConsumableLog>('consumableLogs', {
            consumableId: item.consumableId,
            type: 'ADJUST',
            quantity: Math.abs(item.diffQty),
            unitPrice: item.unitPrice,
            userId: currentUser?.id,
            mechanicId: audit.mechanicId,
            fromLocation: targetLocation,
            toLocation: targetLocation,
            actionDate: audit.auditDate,
            description: `[실사 ${item.diffQty > 0 ? '잉여' : '감모'}] ${audit.auditNo} | ${item.modelName} ${item.diffQty > 0 ? `+${item.diffQty}` : item.diffQty}개 보정 (${reasonText}${item.note ? `: ${item.note}` : ''})`,
            createdAt: new Date().toISOString()
          });
        }
      });

      // 2. 실사 전표 확정 완료 처리
      db.updateRow<StocktakingAudit>('stocktakingAudits', auditId, {
        status: 'CONFIRMED',
        confirmedAt: new Date().toISOString(),
        confirmedBy: currentUser?.name || '관리자',
        updatedAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 확정 처리 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const cancelStocktakingAudit = async (auditId: string): Promise<void> => {
    try {
      const audit = db.stocktakingAudits.find(a => a.id === auditId);
      if (!audit) throw new Error('실사 전표를 찾을 수 없습니다.');
      if (audit.status === 'CONFIRMED') throw new Error('이미 확정된 실사 전표는 취소할 수 없습니다.');

      db.updateRow<StocktakingAudit>('stocktakingAudits', auditId, {
        status: 'CANCELLED',
        updatedAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 실사 전표 취소 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const processCollectedPart = async (
    partId: string, 
    actionStatus: 'IN_PROCESS' | 'COMPLETED', 
    actionMemo?: string
  ): Promise<void> => {
    try {
      const part = db.collectedParts.find(p => p.id === partId);
      if (!part) throw new Error('수거 고품을 찾을 수 없습니다.');

      db.updateRow<CollectedPart>('collectedParts', partId, {
        status: actionStatus,
        actionDate: actionStatus === 'COMPLETED' ? new Date().toISOString().split('T')[0] : part.actionDate,
        actionMemo: actionMemo || part.actionMemo
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 고품 사후처리 갱신 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  // ─── [전사 정비 & AS 단일 물리 통합 핵심 비즈니스 로직 (1-A, 2-B, 3-B, 4-A)] ─────────
  const createFieldAsTicket = async (data: Partial<Repair>): Promise<Repair> => {
    try {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const ymCompact = dateStr.replace(/-/g, '').slice(2, 8);
      const existingList = db.repairs;
      const todayPrefix = `AS-${ymCompact}`;
      let maxNum = 0;
      existingList.forEach(t => {
        if (t.ticketNo && t.ticketNo.startsWith(todayPrefix)) {
          const num = parseInt(t.ticketNo.replace(`${todayPrefix}-`, ''), 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      });
      const ticketNo = `${todayPrefix}-${String(maxNum + 1).padStart(3, '0')}`;
      const newRepairId = data.id || db.generateNextId('repairs', db.repairs);

      // 💡 계약 및 1대 단독계약 자산 자동 매핑 (사장님 확정 1번 원칙)
      let resolvedContractId = data.contractId;
      let resolvedAssetId = data.assetId;
      let resolvedAssetNo = data.assetNo;
      let resolvedModelName = data.modelName;

      if (!resolvedContractId && (data.customerId || data.siteId)) {
        const matchedContract = db.contracts.find(c => 
          (data.customerId && c.customerId === data.customerId) || 
          (data.siteId && c.siteId === data.siteId)
        );
        if (matchedContract) {
          resolvedContractId = matchedContract.id;
        }
      }

      if (resolvedContractId && (!resolvedAssetId || resolvedAssetId === '현장확인' || resolvedAssetNo === '현장확인')) {
        const cas = db.contractAssets.filter(ca => ca.contractId === resolvedContractId && ca.status !== 'RETURNED');
        if (cas.length === 1 && cas[0].assetId) {
          const singleAsset = db.assets.find(a => a.id === cas[0].assetId);
          if (singleAsset) {
            resolvedAssetId = singleAsset.id;
            resolvedAssetNo = singleAsset.assetNo;
            resolvedModelName = singleAsset.modelName;
          }
        }
      }

      // 💡 도로명 상세 주소(siteAddress) 자동 역추적 및 매핑 (T맵/내비 연동 단일 진실의 원천)
      let resolvedSiteAddress = data.siteAddress?.trim();
      if (!resolvedSiteAddress) {
        resolvedSiteAddress = resolveSiteDetailedAddress({
          siteId: data.siteId,
          siteName: data.siteName,
          contractId: resolvedContractId,
          assetNo: resolvedAssetNo,
          assetId: resolvedAssetId,
          customerName: data.customerName,
          locationDetail: data.locationDetail,
          customerSites: db.customerSites,
          contracts: db.contracts,
          contractAssets: db.contractAssets,
          customers: db.customers,
        });
        if (resolvedSiteAddress === (data.siteName || data.customerName || '현장')) {
          const cust = db.customers.find(c => (data.customerId && c.id === data.customerId) || (data.customerName && c.name === data.customerName));
          if (cust?.address?.trim()) {
            resolvedSiteAddress = cust.address.trim();
          } else {
            resolvedSiteAddress = '';
          }
        }
      }

      const initialMemo = data.memo || '';
      const finalMemo = (resolvedSiteAddress && !initialMemo.includes(resolvedSiteAddress))
        ? (initialMemo ? `${initialMemo}\n[현장도로명: ${resolvedSiteAddress}]` : `[현장도로명: ${resolvedSiteAddress}]`)
        : initialMemo;

      const newTicket = db.insertRow<Repair>('repairs', {
        id: newRepairId,
        ticketNo: data.ticketNo || ticketNo,
        workCategory: 'FIELD_AS',
        workLocation: 'SITE',
        stockSource: 'VEHICLE_VAN',
        maintenanceType: 'EMERGENCY_AS',
        repairType: 'INTERNAL',
        source: data.source || 'DIRECT_INTAKE',
        contractId: resolvedContractId,
        customerId: data.customerId || '',
        customerName: data.customerName || '',
        siteId: data.siteId || '',
        siteName: data.siteName || '',
        siteAddress: resolvedSiteAddress || '',
        assetId: resolvedAssetId || '',
        assetNo: resolvedAssetNo || '현장확인',
        modelName: resolvedModelName || '고소작업대',
        locationDetail: data.locationDetail || (resolvedSiteAddress ? resolvedSiteAddress : ''),
        reporterName: data.reporterName || '',
        reporterContact: data.reporterContact || '',
        issueCategory: data.issueCategory || '기타',
        issueDescription: data.issueDescription || '',
        details: data.issueDescription || '',
        errorCode: data.errorCode || '',
        priority: data.priority || 'NORMAL',
        status: data.status || 'REQUESTED',
        requestDate: data.requestDate || dateStr,
        visitDate: data.visitDate || '',
        scheduleDate: data.visitDate || '',
        mechanicId: data.mechanicId || data.assignedMechanicId || '',
        assignedMechanicId: data.mechanicId || data.assignedMechanicId || '',
        mechanicName: data.mechanicName || '',
        actionTaken: data.actionTaken || '',
        resolutionType: data.resolutionType || undefined,
        partsUsed: data.partsUsed || [],
        collectedParts: data.collectedParts || [],
        billableType: data.billableType || 'FREE',
        billableAmount: data.billableAmount || 0,
        billableToCustomer: data.billableType === 'BILLABLE',
        faultImageUrl: data.faultImageUrl || (data.evidenceImages && data.evidenceImages[0]) || '',
        evidenceImages: data.evidenceImages || (data.faultImageUrl ? [data.faultImageUrl] : []),
        beforeImage: data.beforeImage || data.faultImageUrl || (data.evidenceImages && data.evidenceImages[0]) || '',
        afterImage: data.afterImage || '',
        customerSignature: data.customerSignature || '',
        customerConfirmName: data.customerConfirmName || '',
        parentRepairId: data.parentRepairId || data.parentTicketId || '',
        revisitRepairId: data.revisitRepairId || data.revisitTicketId || '',
        revisitDate: data.revisitDate || '',
        revisitReason: data.revisitReason || '',
        exchangeSuggested: !!data.exchangeSuggested,
        memo: finalMemo,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();

      // 🚀 [단일 업무 인계 파이프라인] 정비팀에 물리 ToDo 영구 적재 + 실시간 브로드캐스트
      await issueHandoverTask({
        category: 'AS_DISPATCH_REPAIR',
        title: `[긴급 AS 출동] ${newTicket.customerName || '현장'} (${newTicket.modelName || '장비'})`,
        content: `증상: ${newTicket.issueCategory || '기타'} - ${newTicket.issueDescription || 'AS 요청'} (현장: ${newTicket.siteName || '-'})`,
        targetDept: 'AS',
        priority: 'URGENT',
        actionUrl: '/mobile?tab=as',
        entityType: 'REPAIR',
        entityId: newTicket.id,
        senderId: currentUser?.id,
        senderName: currentUser?.name
      });

      return newTicket;
    } catch (err: any) {
      showErrorModal(`⚠️ AS 접수 생성 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const updateFieldAsTicketStatus = async (ticketId: string, status: Repair['status'], extra?: Partial<Repair>): Promise<void> => {
    try {
      db.updateRow<Repair>('repairs', ticketId, {
        status,
        ...(extra || {}),
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ AS 상태 변경 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const logFieldAsTimelineEvent = async (
    ticketId: string,
    eventType: 'CALL_MADE' | 'TRANSIT_START' | 'ARRIVED' | 'COMPLETED',
    detail?: string
  ): Promise<void> => {
    try {
      const ticket = db.repairs.find(t => t.id === ticketId);
      if (!ticket) return;

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const mechanicName = currentUser?.name || ticket.mechanicName || '담당기사';

      let label = '';
      let newStatus = ticket.status;

      if (eventType === 'CALL_MADE') {
        label = `📞 [${timeStr}] ${mechanicName} 현장 통화 발신 (${detail || ticket.reporterContact || ''})`;
      } else if (eventType === 'TRANSIT_START') {
        label = `🚗 [${timeStr}] ${mechanicName} ${detail || '내비 길안내'} (현장 이동 시작)`;
        if (ticket.status === 'REQUESTED' || ticket.status === 'SCHEDULED') {
          newStatus = 'IN_PROGRESS';
        }
      } else if (eventType === 'ARRIVED') {
        label = `📍 [${timeStr}] ${mechanicName} 현장 도착 및 점검 착수`;
        newStatus = 'IN_PROGRESS';
      } else if (eventType === 'COMPLETED') {
        label = `✅ [${timeStr}] ${mechanicName} 현장 조치 완료 (${detail || ''})`;
      }

      const eventItem = {
        id: `EVT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        eventType,
        label,
        mechanicId: currentUser?.id || ticket.assignedMechanicId || '',
        mechanicName,
        detail,
        timestamp: now.toISOString()
      };

      const existingEvents = ticket.timelineEvents || [];
      const updatedEvents = [...existingEvents, eventItem];

      db.updateRow<Repair>('repairs', ticketId, {
        status: newStatus,
        timelineEvents: updatedEvents,
        updatedAt: now.toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.warn('Timeline log error:', err);
    }
  };

  const completeFieldAsTicket = async (ticketId: string, data: {
    mechanicId: string;
    actionTaken: string;
    resolutionType: Repair['resolutionType'];
    partsUsed?: RepairPartUsed[];
    collectedParts?: RepairCollectedPart[];
    billableType: 'FREE' | 'BILLABLE';
    billableAmount: number;
    beforeImage?: string;
    afterImage?: string;
    customerSignature?: string;
    customerConfirmName?: string;
    revisitDate?: string;
    revisitReason?: string;
    exchangeSuggested?: boolean;
    inspectionItemId?: string;
    inspectionItemCode?: string;
    degradationScore?: number;
    durationMinutes?: number;
    spentManHours?: number;
  }): Promise<void> => {
    try {
      const ticket = db.repairs.find(t => t.id === ticketId);
      if (!ticket) throw new Error('해당 정비/AS 접수건을 찾을 수 없습니다.');

      const mechanic = db.users.find(u => u.id === data.mechanicId);
      const mechanicName = mechanic?.name || ticket.mechanicName || '담당기사';

      // 1. 소모품 차량 재고 유효성 검사 및 차감
      if (data.partsUsed && data.partsUsed.length > 0) {
        for (const part of data.partsUsed) {
          if (!part.quantity || part.quantity <= 0) {
            throw new Error(`사용 부품("${part.modelName}")의 수량은 1개 이상이어야 합니다.`);
          }
          const vehicleStock = db.mechanicConsumableStocks.find(
            s => s.mechanicId === data.mechanicId && s.consumableId === part.consumableId
          );
          const currentQty = vehicleStock?.stockQty || 0;
          if (currentQty < part.quantity) {
            throw new Error(`⚠️ [차량 재고 부족] ${mechanicName} 기사의 차량 재고에 "${part.modelName}" 품목이 부족합니다.\n(현재 적재: ${currentQty}개 / 사용 필요: ${part.quantity}개)\n\n[소모품 관리 ➔ 차량별 이동재고] 메뉴에서 주기장 재고를 차량으로 먼저 불출(이동) 등록해 주시기 바랍니다.`);
          }
        }

        // 실제 차감 수행
        for (const part of data.partsUsed) {
          const vehicleStock = db.mechanicConsumableStocks.find(
            s => s.mechanicId === data.mechanicId && s.consumableId === part.consumableId
          );
          if (vehicleStock) {
            db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', vehicleStock.id, {
              stockQty: vehicleStock.stockQty - part.quantity,
              updatedAt: new Date().toISOString()
            });

            // 소모품 출고 로그 기록
            db.insertRow<ConsumableLog>('consumableLogs', {
              consumableId: part.consumableId,
              type: 'OUTBOUND',
              quantity: part.quantity,
              unitPrice: part.unitPrice,
              userId: currentUser?.id,
              mechanicId: data.mechanicId,
              fromLocation: `${mechanicName} 차량`,
              toLocation: `현장AS (${ticket.siteName || ''} / ${ticket.assetNo || ''})`,
              actionDate: new Date().toISOString().split('T')[0],
              description: `[현장AS 조치 소진] ${ticket.assetNo || ''} 수리 사용 (${ticket.ticketNo || ticket.id})`,
              createdAt: new Date().toISOString()
            });
          }
        }
      }

      // 2. 재방문 연계 티켓 생성 (선택된 경우)
      let revisitRepairId: string | undefined = undefined;
      let finalStatus: Repair['status'] = 'COMPLETED';

      if (data.resolutionType === 'REVISIT_NEEDED') {
        finalStatus = 'REVISIT';
        const now = new Date();
        const ymCompact = now.toISOString().split('T')[0].replace(/-/g, '').slice(2, 8);
        const todayPrefix = `AS-${ymCompact}`;
        let maxNum = 0;
        db.repairs.forEach(t => {
          if (t.ticketNo && t.ticketNo.startsWith(todayPrefix)) {
            const num = parseInt(t.ticketNo.replace(`${todayPrefix}-`, ''), 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });
        const nextTicketNo = `${todayPrefix}-${String(maxNum + 1).padStart(3, '0')}`;
        const chainedId = db.generateNextId('repairs', db.repairs);

        const chainedTicket = db.insertRow<Repair>('repairs', {
          id: chainedId,
          ticketNo: nextTicketNo,
          workCategory: 'FIELD_AS',
          workLocation: 'SITE',
          stockSource: 'VEHICLE_VAN',
          maintenanceType: 'EMERGENCY_AS',
          repairType: 'INTERNAL',
          source: 'DIRECT_INTAKE',
          customerId: ticket.customerId,
          customerName: ticket.customerName,
          siteId: ticket.siteId,
          siteName: ticket.siteName,
          assetId: ticket.assetId,
          assetNo: ticket.assetNo,
          locationDetail: ticket.locationDetail,
          reporterName: ticket.reporterName,
          reporterContact: ticket.reporterContact,
          issueCategory: ticket.issueCategory,
          issueDescription: `[재방문 사유] ${data.revisitReason || '후속 조치 필요'} (원 접수: ${ticket.issueDescription})`,
          details: `[재방문 사유] ${data.revisitReason || '후속 조치 필요'} (원 접수: ${ticket.issueDescription})`,
          errorCode: ticket.errorCode,
          priority: ticket.priority,
          status: 'SCHEDULED',
          requestDate: new Date().toISOString().split('T')[0],
          visitDate: data.revisitDate || new Date(Date.now() + 86400000).toISOString().split('T')[0],
          scheduleDate: data.revisitDate || new Date(Date.now() + 86400000).toISOString().split('T')[0],
          mechanicId: data.mechanicId,
          assignedMechanicId: data.mechanicId,
          mechanicName,
          billableType: data.billableType,
          billableAmount: 0,
          billableToCustomer: data.billableType === 'BILLABLE',
          parentRepairId: ticket.id,
          parentTicketId: ticket.id,
          memo: `이전 AS 티켓(${ticket.ticketNo || ticket.id}) 1차 점검 후 연계 생성됨`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        revisitRepairId = chainedTicket.id;
      } else if (data.resolutionType === 'GUIDED_END') {
        finalStatus = 'GUIDED';
      }

      // 3. 현재 티켓 완료/종결 업데이트
      const sanitizedBillableAmount = Math.max(0, Number(data.billableAmount) || 0);
      db.updateRow<Repair>('repairs', ticketId, {
        status: finalStatus,
        mechanicId: data.mechanicId,
        assignedMechanicId: data.mechanicId,
        mechanicName,
        actionTaken: data.actionTaken,
        resolutionType: data.resolutionType,
        partsUsed: data.partsUsed || [],
        collectedParts: data.collectedParts || [],
        billableType: data.billableType,
        billableAmount: sanitizedBillableAmount,
        billableToCustomer: data.billableType === 'BILLABLE',
        beforeImage: data.beforeImage || ticket.beforeImage,
        afterImage: data.afterImage || ticket.afterImage,
        customerSignature: data.customerSignature || ticket.customerSignature,
        customerConfirmName: data.customerConfirmName || ticket.customerConfirmName,
        revisitDate: data.revisitDate,
        revisitReason: data.revisitReason,
        revisitRepairId: revisitRepairId || ticket.revisitRepairId,
        revisitTicketId: revisitRepairId || ticket.revisitTicketId,
        exchangeSuggested: !!data.exchangeSuggested,
        inspectionItemId: data.inspectionItemId !== undefined ? data.inspectionItemId : ticket.inspectionItemId,
        inspectionItemCode: data.inspectionItemCode !== undefined ? data.inspectionItemCode : ticket.inspectionItemCode,
        degradationScore: data.degradationScore !== undefined ? data.degradationScore : ticket.degradationScore,
        durationMinutes: data.durationMinutes !== undefined ? data.durationMinutes : ticket.durationMinutes,
        spentManHours: data.spentManHours !== undefined ? data.spentManHours : ticket.spentManHours,
        completedDate: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 🟢 선행 AS 출동 ToDo 원자적 자동 상계
      await clearHandoverTasks({
        entityType: 'REPAIR',
        entityId: ticketId,
        category: 'AS_DISPATCH_REPAIR',
        completedByUserId: currentUser?.id,
        completedByName: currentUser?.name,
        completionAction: `AS_${finalStatus}`
      });

      // 🚀 고객 과실 유상 수리 시 청구팀에 바인딩 ToDo 발행 (매출 누락 방지)
      if (sanitizedBillableAmount > 0) {
        await issueHandoverTask({
          category: 'BILLABLE_REPAIR_BILLING',
          title: `[유상AS 청구 반영] ${ticket.customerName || '고객사'} (₩${sanitizedBillableAmount.toLocaleString()}원)`,
          content: `고객 과실 유상 수리비 ₩${sanitizedBillableAmount.toLocaleString()}원 청구서 바인딩 요망 (${ticket.siteName || '현장'}, ${data.actionTaken || '수리'})`,
          targetDept: 'ACCOUNTING',
          priority: 'HIGH',
          actionUrl: '/admin/billing',
          entityType: 'REPAIR',
          entityId: ticketId,
          senderId: currentUser?.id,
          senderName: currentUser?.name
        });
      }

      // 🌟 [헌장 2.3 준수] 현장 수리 불능 대차 제안 시 단일 'EXCHANGE' 왕복 배차 의뢰 1건 자동 발행
      if (data.exchangeSuggested) {
        const defaultYard = currentTenant?.yards?.find((y: any) => y.isDefault) || currentTenant?.yards?.[0];
        const originYardAddress = defaultYard ? `${defaultYard.name} (${defaultYard.address || ''})` : (currentTenant?.mainYardAddress || '본사 주기장');

        const deliveryId = db.generateNextId('deliveries', db.deliveries);
        db.insertRow<Delivery>('deliveries', {
          id: deliveryId,
          contractId: ticket.contractId,
          type: 'EXCHANGE',
          dispatchCategory: '교환',
          status: 'PENDING',
          requestDate: new Date().toISOString().split('T')[0],
          originAddress: originYardAddress,
          pickupType: 'HQ_YARD',
          destinationAddress: ticket.locationDetail || ticket.siteName || '현장',
          dropoffType: 'CUSTOMER_SITE',
          deliveryCost: 0,
          memo: `[현장AS 대차 요청] 회수대상 자산: ${ticket.assetNo || '현장고장장비'} / 현장: ${ticket.siteName || ''} (${ticket.customerName || ''}) / 사유: ${data.actionTaken || '현장 수리불능 대차'}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        // 🚀 대차 배차 지시 ToDo 발행
        await issueHandoverTask({
          category: 'DISPATCH_REQUEST',
          title: `[대차 교환 배차] ${ticket.customerName || '고객사'} (${ticket.assetNo || '장비'})`,
          content: `현장 수리불능 대차 요청. 신규 장비 출고 및 고장 장비 회수 왕복 1건 배차 처리. (현장: ${ticket.siteName || '-'})`,
          targetDept: 'DISPATCH',
          priority: 'URGENT',
          actionUrl: '/admin/dispatch',
          entityType: 'DELIVERY',
          entityId: deliveryId,
          senderId: currentUser?.id,
          senderName: currentUser?.name
        });
      }

      // 4. 자산 이력(AssetInOutLog)에 정비 사건 무누락 DB 저장
      const targetAssetNo = ticket.assetNo;
      if (targetAssetNo && targetAssetNo !== '현장확인' && targetAssetNo !== '전체장비') {
        const matchedAsset = db.assets.find(a => a.assetNo === targetAssetNo);
        db.insertRow<AssetInOutLog>('assetInOutLogs', {
          assetId: matchedAsset?.id || ticket.assetId || `asset-${targetAssetNo}`,
          assetNo: targetAssetNo,
          modelName: matchedAsset?.modelName || ticket.locationDetail || '고소작업대',
          type: 'REPAIR',
          eventDate: new Date().toISOString().split('T')[0],
          customerId: ticket.customerId,
          customerName: ticket.customerName,
          siteId: ticket.siteId,
          siteName: ticket.siteName,
        });
      }

      // 5. 계약 이력(ContractHistory)에 AS 발생 및 조치 사건 무누락 DB 저장 (양방향 완벽 추적성)
      if (ticket.contractId) {
        db.insertRow<ContractHistory>('contract_history', {
          id: `ch-as-${ticket.id}-${Date.now()}`,
          contractId: ticket.contractId,
          changeType: 'AS_SERVICE',
          changeDate: new Date().toISOString().split('T')[0],
          description: `[현장 AS ${finalStatus === 'COMPLETED' ? '완료' : '조치'}] ${data.actionTaken} (${ticket.assetNo || '현장장비'}, 정비사: ${mechanicName}${data.billableAmount && data.billableAmount > 0 ? `, 유상수리비 ₩${data.billableAmount.toLocaleString()}` : ''})`,
          createdAt: new Date().toISOString()
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();

      // 📢 대차 제안 시 배차/출고팀에 대차교체 알림 브로드캐스트
      if (data.exchangeSuggested) {
        broadcastWorkNotification({
          type: 'EXCHANGE',
          title: '대차 교체 의뢰 등록',
          body: `${ticket.customerName || '고객사'} (${ticket.siteName || '현장'}) ${ticket.assetNo || '장비'} 현장수리불능 대차요청`,
          url: '/admin/dispatch',
          targetDepts: ['DISPATCH', 'YARD', 'ADMIN', 'EXECUTIVE']
        }).catch(console.warn);
      }
    } catch (err: any) {
      showErrorModal(err?.message || String(err));
      throw err;
    }
  };

  const createRevisitAsTicket = async (parentRepairId: string, revisitDate: string, revisitReason: string, mechanicId?: string): Promise<Repair> => {
    try {
      const parent = db.repairs.find(t => t.id === parentRepairId);
      if (!parent) throw new Error('이전 AS 티켓을 찾을 수 없습니다.');

      const now = new Date();
      const ymCompact = now.toISOString().split('T')[0].replace(/-/g, '').slice(2, 8);
      const todayPrefix = `AS-${ymCompact}`;
      let maxNum = 0;
      db.repairs.forEach(t => {
        if (t.ticketNo && t.ticketNo.startsWith(todayPrefix)) {
          const num = parseInt(t.ticketNo.replace(`${todayPrefix}-`, ''), 10);
          if (!isNaN(num) && num > maxNum) maxNum = num;
        }
      });
      const nextTicketNo = `${todayPrefix}-${String(maxNum + 1).padStart(3, '0')}`;
      const newId = db.generateNextId('repairs', db.repairs);

      const effectiveMechId = mechanicId || parent.mechanicId || parent.assignedMechanicId;
      const mech = db.users.find(u => u.id === effectiveMechId);

      const newTicket = db.insertRow<Repair>('repairs', {
        id: newId,
        ticketNo: nextTicketNo,
        workCategory: 'FIELD_AS',
        workLocation: 'SITE',
        stockSource: 'VEHICLE_VAN',
        maintenanceType: 'EMERGENCY_AS',
        repairType: 'INTERNAL',
        source: 'DIRECT_INTAKE',
        customerId: parent.customerId,
        customerName: parent.customerName,
        siteId: parent.siteId,
        siteName: parent.siteName,
        assetId: parent.assetId,
        assetNo: parent.assetNo,
        locationDetail: parent.locationDetail,
        reporterName: parent.reporterName,
        reporterContact: parent.reporterContact,
        issueCategory: parent.issueCategory,
        issueDescription: `[재방문] ${revisitReason} (원 접수: ${parent.issueDescription || parent.details})`,
        details: `[재방문] ${revisitReason} (원 접수: ${parent.issueDescription || parent.details})`,
        errorCode: parent.errorCode,
        priority: parent.priority,
        status: 'SCHEDULED',
        requestDate: now.toISOString().split('T')[0],
        visitDate: revisitDate,
        scheduleDate: revisitDate,
        mechanicId: effectiveMechId,
        assignedMechanicId: effectiveMechId,
        mechanicName: mech?.name || parent.mechanicName,
        billableType: parent.billableType,
        billableAmount: 0,
        billableToCustomer: parent.billableToCustomer,
        parentRepairId: parent.id,
        parentTicketId: parent.id,
        memo: `티켓 ${parent.ticketNo || parent.id}에서 재방문 연계 생성`,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });

      db.updateRow<Repair>('repairs', parentRepairId, {
        revisitRepairId: newTicket.id,
        revisitTicketId: newTicket.id,
        updatedAt: now.toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
      return newTicket;
    } catch (err: any) {
      showErrorModal(`⚠️ 재방문 티켓 생성 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const importBandAsHistory = async (records: any[]): Promise<number> => {
    try {
      let importedCount = 0;
      const existingList = db.repairs;
      const existingRawSet = new Set(existingList.map(t => `${t.siteName}_${t.assetNo}_${t.requestDate}_${(t.issueDescription || t.details || '').slice(0, 20)}`));

      const newRepairs: Repair[] = [];
      const newAssetLogs: AssetInOutLog[] = [];

      records.forEach((r, idx) => {
        const site = r.site || '미지정현장';
        const asset = r.asset_no || '현장확인';
        const reqDate = r.date || '2026-08-01';
        const issue = r.issue || (r.raw ? r.raw.slice(0, 100) : '점검 요청');
        const dedupeKey = `${site}_${asset}_${reqDate}_${issue.slice(0, 20)}`;

        if (existingRawSet.has(dedupeKey)) return;

        existingRawSet.add(dedupeKey);
        importedCount++;

        const ticketNo = `BAND-${String(5518 - idx).padStart(4, '0')}`;
        const rawText = r.raw || '';
        const isRevisit = rawText.includes('내일방문') || rawText.includes('재방문') || rawText.includes('방문예정');
        const isGuided = rawText.includes('설명처리') || rawText.includes('이상없음') || rawText.includes('문제없음');
        const isCompleted = rawText.includes('완료') || rawText.includes('교체') || rawText.includes('수리') || rawText.includes('보수');

        let status: Repair['status'] = 'COMPLETED';
        let resolutionType: Repair['resolutionType'] = 'REPAIR_DONE';
        if (isRevisit) {
          status = 'REVISIT';
          resolutionType = 'REVISIT_NEEDED';
        } else if (isGuided) {
          status = 'GUIDED';
          resolutionType = 'GUIDED_END';
        } else if (isCompleted) {
          status = 'COMPLETED';
          resolutionType = 'REPAIR_DONE';
        }

        let category = '기타';
        if (issue.includes('방지봉') || issue.includes('협착')) category = '방지봉/협착';
        else if (issue.includes('상승') || issue.includes('하강')) category = '상하강불량';
        else if (issue.includes('충전') || issue.includes('배터리')) category = '충전/전원';
        else if (issue.includes('오일') || issue.includes('누유')) category = '오일누유';
        else if (issue.includes('키박스') || issue.includes('키스위치')) category = '키박스/스위치';
        else if (issue.includes('파이프')) category = '파이프걸림';
        else if (issue.includes('점검')) category = '점검요청';

        // 💡 4-A 원칙: 밴드 작성자 ➔ 시스템 users 이름 1:1 자동 매칭
        const authorName = (r.author || '').trim();
        const matchedUser = db.users.find(u => u.name && authorName && (u.name.trim() === authorName || authorName.includes(u.name.trim())));
        const mechanicId = matchedUser?.id || '';
        const mechanicName = matchedUser?.name || authorName || '정비기사';

        // 💡 고객사 및 현장 매칭
        const contractorName = (r.contractor || '').trim();
        let matchedCustomer = db.customers.find(c => 
          c.name && contractorName && (
            c.name.trim() === contractorName || 
            contractorName.includes(c.name.trim()) || 
            c.name.trim().includes(contractorName)
          )
        );
        let matchedSite = db.customerSites.find(s => 
          s.name && site && (
            s.name.trim() === site.trim() || 
            site.includes(s.name.trim()) || 
            s.name.trim().includes(site)
          )
        );

        // 계약 조회 (고객/현장 기준)
        let matchedContract = db.contracts.find(c => 
          (matchedCustomer && c.customerId === matchedCustomer.id) || 
          (matchedSite && c.siteId === matchedSite.id)
        );

        // 💡 5대 매트릭스 & 사장님 확정 원칙 1: 관리번호 미기재 시 1대 단독 계약이면 해당 자산으로 자동 추정 매핑
        let finalAssetNo = asset;
        let matchedAsset = db.assets.find(a => a.assetNo && asset && a.assetNo.trim().toUpperCase() === asset.trim().toUpperCase());
        if (!matchedAsset && asset && asset !== '현장확인') {
          const cleanNo = asset.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          matchedAsset = db.assets.find(a => a.assetNo && a.assetNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === cleanNo);
        }
        let assetId = matchedAsset?.id || '';

        const currentContract = matchedContract;
        if ((!finalAssetNo || finalAssetNo === '현장확인' || finalAssetNo === '전체장비') && currentContract) {
          const contractAssetsForContract = db.contractAssets.filter(ca => ca.contractId === currentContract.id && ca.status !== 'RETURNED');
          if (contractAssetsForContract.length === 1 && contractAssetsForContract[0].assetId) {
            const singleAsset = db.assets.find(a => a.id === contractAssetsForContract[0].assetId);
            if (singleAsset) {
              assetId = singleAsset.id;
              finalAssetNo = singleAsset.assetNo;
              matchedAsset = singleAsset;
            }
          }
        } else if (matchedAsset && !matchedContract) {
          const currentAsset = matchedAsset;
          const activeCa = db.contractAssets.find(ca => ca.assetId === currentAsset.id && ca.status !== 'RETURNED');
          if (activeCa) {
            matchedContract = db.contracts.find(c => c.id === activeCa.contractId);
          }
        }

        // 🌟 자산 마스터 기준 현장 및 고객사 역추적 (Back-tracking)
        if (matchedAsset) {
          if ((!matchedSite || !site || site === '미지정현장' || site === '일반 현장') && matchedAsset.currentSiteId) {
            const foundSite = db.customerSites.find(s => s.id === matchedAsset.currentSiteId);
            if (foundSite) {
              matchedSite = foundSite;
            }
          }
          if ((!matchedCustomer || !r.contractor || r.contractor === '현장 협력업체' || r.contractor === '협력업체') && matchedAsset.currentCustomerId) {
            const foundCust = db.customers.find(c => c.id === matchedAsset.currentCustomerId);
            if (foundCust) {
              matchedCustomer = foundCust;
            }
          }
          if (matchedContract) {
            if (!matchedSite && matchedContract.siteId) {
              matchedSite = db.customerSites.find(s => s.id === matchedContract.siteId);
            }
            if (!matchedCustomer && matchedContract.customerId) {
              matchedCustomer = db.customers.find(c => c.id === matchedContract.customerId);
            }
          }
        }

        const actionText = r.action || (isCompleted ? '현장 정비 및 조치 완료' : (isRevisit ? '익일 재방문 접수' : '설명 및 안내 종결'));

        const repairRow: Repair = {
          id: `rep-band-${idx + 1}`,
          ticketNo,
          workCategory: 'FIELD_AS',
          workLocation: 'SITE',
          stockSource: 'VEHICLE_VAN',
          maintenanceType: 'EMERGENCY_AS',
          repairType: 'INTERNAL',
          source: 'BAND_IMPORT',
          contractId: matchedContract?.id || undefined,
          customerId: matchedCustomer?.id || '',
          customerName: matchedCustomer?.name || r.contractor || '현장 협력업체',
          siteId: matchedSite?.id || '',
          siteName: matchedSite?.name || site,
          assetId: assetId || undefined,
          assetNo: finalAssetNo || '현장확인',
          modelName: matchedAsset?.modelName || '고소작업대',
          locationDetail: r.location || '',
          reporterContact: r.contact || '',
          issueCategory: category,
          issueDescription: issue,
          details: issue,
          status,
          resolutionType,
          priority: 'NORMAL',
          requestDate: reqDate,
          visitDate: reqDate,
          scheduleDate: reqDate,
          completedDate: status === 'COMPLETED' ? reqDate : undefined,
          mechanicId,
          assignedMechanicId: mechanicId,
          mechanicName,
          actionTaken: actionText,
          billableType: 'FREE',
          billableAmount: 0,
          billableToCustomer: false,
          memo: `[밴드 과거이력 자동 임포트]\n작성자: ${authorName || '기사'}\n원문: ${rawText.slice(0, 150)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        newRepairs.push(repairRow);

        // 💡 자산 생애주기 이력 로그(AssetInOutLog) 동시 기록 (관리번호가 식별되는 장비)
        if (finalAssetNo && finalAssetNo !== '현장확인' && finalAssetNo !== '전체장비') {
          newAssetLogs.push({
            id: `aiog-band-${idx + 1}`,
            assetId: assetId || `asset-${finalAssetNo}`,
            assetNo: finalAssetNo,
            modelName: matchedAsset?.modelName || '고소작업대',
            type: 'REPAIR',
            eventDate: reqDate,
            customerName: repairRow.customerName,
            siteName: repairRow.siteName,
            repairId: repairRow.id,
            memo: `[현장AS] ${issue} ➔ ${actionText} (정비자: ${mechanicName})`,
            createdAt: new Date().toISOString()
          });
        }
      });

      if (newRepairs.length > 0) {
        db.repairs = [...newRepairs, ...db.repairs];
        if (newAssetLogs.length > 0) {
          db.assetInOutLogs = [...newAssetLogs, ...db.assetInOutLogs];
        }
        await db.awaitPendingWrites();
        refreshAllData();
      }

      return importedCount;
    } catch (err: any) {
      showErrorModal(`⚠️ 밴드 데이터 가져오기 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const getValidUserId = (id?: string): string => {
    if (id && id !== 'system') {
      const exists = db.users.some(u => u.id === id);
      if (exists) return id;
    }
    return db.users[0]?.id || 'usr-admin';
  };

  const requestConsumablePurchase = async (data: { consumableId?: string; modelName: string; qty: number; unitPrice: number; requestDate: string; sellerName: string }) => {
    const validUserId = getValidUserId(currentUser?.id);
    const newReq = db.insertRow<ConsumablePurchaseRequest>('consumablePurchases', {
      consumableId: data.consumableId || undefined,
      modelName: data.modelName,
      requestedQty: data.qty,
      unitPrice: data.unitPrice,
      requestDate: data.requestDate,
      sellerName: data.sellerName,
      status: 'REQUESTED',
      requesterId: validUserId,
      requesterName: currentUser?.name || '시스템',
      receivedQty: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // 🚀 [단일 업무 인계 파이프라인] 관리자/부서장에게 구매 결재 ToDo 발행
    await issueHandoverTask({
      category: 'CONSUMABLE_PURCHASE_APPROVAL',
      title: `[소모품 구매 승인] ${data.modelName} (${data.qty}EA)`,
      content: `구매 요청: ${data.modelName} ${data.qty}개 (단가: ₩${data.unitPrice.toLocaleString()}원, 공급처: ${data.sellerName})`,
      targetRole: 'MANAGER',
      priority: data.unitPrice * data.qty >= 1000000 ? 'HIGH' : 'NORMAL',
      actionUrl: '/admin/consumable',
      entityType: 'CONSUMABLE',
      entityId: newReq.id,
      senderId: currentUser?.id,
      senderName: currentUser?.name
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const acceptConsumablePurchase = async (id: string) => {
    const validUserId = getValidUserId(currentUser?.id);
    db.updateRow<ConsumablePurchaseRequest>('consumablePurchases', id, {
      status: 'ACCEPTED',
      acceptedDate: new Date().toISOString().split('T')[0],
      accepterId: validUserId,
      accepterName: currentUser?.name || '시스템',
      updatedAt: new Date().toISOString()
    });

    // 🟢 구매 결재 ToDo 자동 상계
    await clearHandoverTasks({
      entityType: 'CONSUMABLE',
      entityId: id,
      category: 'CONSUMABLE_PURCHASE_APPROVAL',
      completedByUserId: currentUser?.id,
      completedByName: currentUser?.name,
      completionAction: 'PURCHASE_ACCEPTED'
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const completeConsumablePurchase = async (id: string) => {
    const req = db.consumablePurchases.find(p => p.id === id);
    if (!req) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const nowIso = new Date().toISOString();
    const settlementYm = req.requestDate ? req.requestDate.substring(0, 7) : todayStr.substring(0, 7);
    const effectiveQty = (req.receivedQty && req.receivedQty > 0) ? req.receivedQty : req.requestedQty;
    const totalAmount = effectiveQty * (req.unitPrice || 0);

    // 1. 월말 매입 정산 마스터 레코드 (PurchaseSettlement) 생성
    const settlementId = db.generateNextId('purchaseSettlements', db.purchaseSettlements);
    const settlement = db.insertRow<PurchaseSettlement>('purchaseSettlements', {
      id: settlementId,
      settlementYm,
      settlementType: 'CONSUMABLE',
      vendorName: req.sellerName || '소모품 공급처',
      totalAmount,
      paidAmount: 0,
      status: 'CONFIRMED',
      confirmedAt: nowIso,
      confirmedBy: currentUser?.name || req.requesterName || '구매신청자',
      itemCount: 1,
      memo: `[소모품 구매완결] ${req.modelName} ${effectiveQty}개 (신청자: ${req.requesterName || currentUser?.name || '담당자'})`,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    // 2. 월말 매입 정산 1:1 상세 항목 (PurchaseSettlementItem) 생성
    const settlementItemId = db.generateNextId('purchaseSettlementItems', db.purchaseSettlementItems);
    db.insertRow<PurchaseSettlementItem>('purchaseSettlementItems', {
      id: settlementItemId,
      settlementId: settlement.id,
      sourceType: 'CONSUMABLE_PURCHASE',
      sourceId: req.id,
      itemDescription: `${req.modelName} × ${effectiveQty}개 (${req.requestDate || todayStr})`,
      quantity: effectiveQty,
      unitPrice: req.unitPrice || 0,
      amount: totalAmount,
      evidenceFileUrl: req.statementFileUrl || undefined,
      createdAt: nowIso
    });

    // 3. 소모품 구매신청 완결 상태 및 연계 정산 ID 업데이트
    db.updateRow<ConsumablePurchaseRequest>('consumablePurchases', id, {
      status: 'COMPLETED',
      completedDate: todayStr,
      completerName: currentUser?.name || '구매신청자',
      settlementId: settlement.id,
      updatedAt: nowIso
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const inboundConsumablePurchase = async (id: string, qty: number, statementFileUrl: string) => {
    const req = db.consumablePurchases.find(p => p.id === id);
    if (!req) return;

    const nextReceivedQty = req.receivedQty + qty;

    db.updateRow<ConsumablePurchaseRequest>('consumablePurchases', id, {
      receivedQty: nextReceivedQty,
      statementFileUrl,
      inbounderName: currentUser?.name || '시스템',
      updatedAt: new Date().toISOString()
    });

    let consumable = req.consumableId ? db.consumables.find(c => c.id === req.consumableId) : null;
    if (!consumable) {
      consumable = db.consumables.find(c => c.modelName.replace(/\s/g, '') === req.modelName.replace(/\s/g, '')) || null;
    }

    if (consumable) {
      db.updateRow<Consumable>('consumables', consumable.id, {
        stockQty: consumable.stockQty + qty,
        unitPrice: req.unitPrice,
        supplier: req.sellerName,
        updatedAt: new Date().toISOString()
      });
    } else {
      consumable = db.insertRow<Consumable>('consumables', {
        modelName: req.modelName,
        stockQty: qty,
        unit: '개',
        unitPrice: req.unitPrice,
        supplier: req.sellerName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      // ⚠️ FK(Foreign Key) 위반 방지: consumables 마스터 생성이 원격 DB에 먼저 반영되도록 1차 동기 대기
      try {
        await db.awaitPendingWrites();
      } catch (e) {
        console.warn('Consumable insert pending write warning:', e);
      }
      db.updateRow<ConsumablePurchaseRequest>('consumablePurchases', id, {
        consumableId: consumable.id
      });
    }

    db.insertRow<ConsumableLog>('consumableLogs', {
      consumableId: consumable.id,
      type: 'INBOUND',
      quantity: qty,
      unitPrice: req.unitPrice,
      supplier: req.sellerName,
      userId: getValidUserId(currentUser?.id),
      actionDate: new Date().toISOString().split('T')[0],
      description: `구매신청 연계 입고 (증빙: ${statementFileUrl.split('/').pop()})`,
      createdAt: new Date().toISOString()
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 증빙 파일 Storage 삭제 후 DB URL 초기화
  const clearEvidenceFileUrls = async (ids: string[]): Promise<void> => {
    for (const id of ids) {
      db.updateRow<ConsumablePurchaseRequest>('consumablePurchases', id, { statementFileUrl: '' });
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  // Storage 삭제 후 Drive URL로 교체
  const updateEvidenceFileUrls = async (updates: { id: string; url: string }[]): Promise<void> => {
    for (const { id, url } of updates) {
      db.updateRow<ConsumablePurchaseRequest>('consumablePurchases', id, { statementFileUrl: url });
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const createContract = async (contractData: Omit<Contract, 'id' | 'createdAt' | 'updatedAt' | 'contractNo'>, assetsList: { assetId?: string; expectedModel?: string; monthlyRentalFee: number; dailyRentalFee: number }[]) => {
    const customer = db.customers.find(c => c.id === contractData.customerId);
    if (customer && customer.transactionStatus === 'BLOCKED') {
      showErrorModal('⚠️ 해당 고객사는 [거래불가(BLOCKED)] 상태로 설정되어 있어 신규 계약 등록이 불가능합니다.', '계약 등록 제한');
      throw new Error('거래 불가 고객사입니다.');
    }

    const contractNo = generateNextContractNo();
    
    const contract = db.insertRow<Contract>('contracts', {
      ...contractData,
      contractNo,
      billingDay: contractData.billingDay || customer?.defaultBillingDay || 30,
      paymentDueDay: contractData.paymentDueDay || customer?.paymentDueDay || 25,
      salespersonId: contractData.salespersonId || currentUser?.id,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    // ⚠️ 외래키(Foreign Key) 제약조건 위반 방지: contract가 Supabase 원격 DB에 먼저 100% 생성되도록 1차 동기 대기!
    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error('Supabase contract insert sync error in saveContract:', err);
    }

    const nowIso = new Date().toISOString();
    assetsList.forEach(item => {
      const insertedCA = db.insertRow<ContractAsset>('contractAssets', {
        contractId: contract.id,
        assetId: item.assetId || undefined,
        expectedModel: item.expectedModel || undefined,
        monthlyRentalFee: item.monthlyRentalFee,
        dailyRentalFee: item.dailyRentalFee,
        startDate: contractData.startDate,
        endDate: contractData.endDate,
        createdAt: nowIso
      });

      if (item.assetId) {
        db.updateRow<Asset>('assets', item.assetId, {
          // 💡 헌장 1.3 준수: 계약 체결 시점에는 RENTED(대여중)로 변경하지 않고 ASSIGNED(출고대기) 유지, 출고 검수 승인 마감 시점에 RENTED로 전이됨!
          status: 'ASSIGNED',
          currentCustomerId: contractData.customerId,
          currentSiteId: contractData.siteId,
          contractStart: contractData.startDate,
          contractEnd: contractData.endDate,
          monthlyRentalFee: item.monthlyRentalFee,
          dailyRentalFee: item.dailyRentalFee,
          updatedAt: nowIso
        });
        // ✅ 고아 레코드 방지: assetId가 있는 슬롯 생성 시 출고검수 의뢰 자동 연동 생성
        db.insertRow<OutboundInspection>('outboundInspections', {
          contractId: contract.id,
          contractAssetId: insertedCA.id,
          assetId: item.assetId,
          status: 'PENDING',
          createdAt: nowIso,
          updatedAt: nowIso
        });
      }
    });

    db.insertRow<ContractHistory>('contractHistory', {
      contractId: contract.id,
      changeType: 'REGISTER',
      changeDate: new Date().toISOString().split('T')[0],
      newEndDate: contractData.endDate,
      description: '계약 신규 등록',
      createdAt: new Date().toISOString()
    });

    const today = new Date().toISOString().split('T')[0];
    db.insertRow<Delivery>('deliveries', {
      contractId: contract.id,
      type: 'OUTBOUND',
      dispatchCategory: '출고',
      status: 'REQUESTED',
      requestDate: today,
      loadingDate: today,
      loadingTimeSlot: '오전',
      unloadingDate: today,
      unloadingTimeSlot: '오전',
      deliveryCost: 0,
      isCostSettled: false,
      memo: '신규 계약 체결에 따른 스마트 출고 의뢰',
      closingMemo: '스마트 출고 파이프라인 자동 지시건',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const extendContract = async (contractId: string, newEndDate: string, description: string) => {
    const contract = db.contracts.find(c => c.id === contractId);
    if (!contract) {
      showErrorModal('계약 정보를 찾을 수 없습니다.');
      return;
    }
    if (!newEndDate) {
      showErrorModal('연장 종료일을 입력하십시오.');
      return;
    }
    if (contract.startDate && newEndDate < contract.startDate) {
      showErrorModal(`연장 종료일(${newEndDate})은 계약 시작일(${contract.startDate}) 이후여야 합니다.`);
      return;
    }

    const prevEnd = contract.endDate;

    db.updateRow<Contract>('contracts', contractId, {
      endDate: newEndDate,
      status: 'EXTENDED',
      updatedAt: new Date().toISOString()
    });

    const cAssets = db.contractAssets.filter(ca => ca.contractId === contractId);
    cAssets.forEach(ca => {
      db.updateRow<ContractAsset>('contractAssets', ca.id, { endDate: newEndDate });
      if (ca.assetId) {
        db.updateRow<Asset>('assets', ca.assetId, {
          contractEnd: newEndDate,
          updatedAt: new Date().toISOString()
        });
      }
    });

    db.insertRow<ContractHistory>('contractHistory', {
      contractId,
      changeType: 'EXTEND',
      changeDate: new Date().toISOString().split('T')[0],
      prevEndDate: prevEnd,
      newEndDate,
      description: `계약 연장 처리: ${description}`,
      createdAt: new Date().toISOString()
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const shortenContract = async (contractId: string, newEndDate: string, description: string) => {
    const contract = db.contracts.find(c => c.id === contractId);
    if (!contract) {
      showErrorModal('계약 정보를 찾을 수 없습니다.');
      return;
    }
    if (!newEndDate) {
      showErrorModal('단축 종료일을 입력하십시오.');
      return;
    }
    if (contract.startDate && newEndDate < contract.startDate) {
      showErrorModal(`단축 종료일(${newEndDate})은 계약 시작일(${contract.startDate}) 이후여야 합니다.`);
      return;
    }

    const prevEnd = contract.endDate;

    db.updateRow<Contract>('contracts', contractId, {
      endDate: newEndDate,
      status: 'SHORTENED',
      updatedAt: new Date().toISOString()
    });

    const cAssets = db.contractAssets.filter(ca => ca.contractId === contractId);
    cAssets.forEach(ca => {
      db.updateRow<ContractAsset>('contractAssets', ca.id, { endDate: newEndDate });
      if (ca.assetId) {
        db.updateRow<Asset>('assets', ca.assetId, {
          contractEnd: newEndDate,
          updatedAt: new Date().toISOString()
        });
      }
    });

    db.insertRow<ContractHistory>('contractHistory', {
      contractId,
      changeType: 'SHORTEN',
      changeDate: new Date().toISOString().split('T')[0],
      prevEndDate: prevEnd,
      newEndDate,
      description: `계약 단축 처리: ${description}`,
      createdAt: new Date().toISOString()
    });

    db.insertRow<Delivery>('deliveries', {
      contractId: contract.id,
      type: 'INBOUND',
      status: 'REQUESTED',
      requestDate: new Date().toISOString().split('T')[0],
      scheduledDate: newEndDate,
      deliveryCost: 0,
      isCostSettled: false,
      memo: '계약 조기 단축/만료에 따른 회수 의뢰',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const succeedContract = async (contractId: string, successorCustomerId: string, successorContactId: string, successorSiteId: string, successionDate: string, description: string) => {
    const oldContract = db.contracts.find(c => c.id === contractId);
    if (!oldContract) {
      showErrorModal('승계 대상 계약을 찾을 수 없습니다.');
      return;
    }
    if (!successionDate) {
      showErrorModal('승계일자를 입력하십시오.');
      return;
    }
    if (oldContract.startDate && successionDate < oldContract.startDate) {
      showErrorModal(`승계일자(${successionDate})는 기존 계약 시작일(${oldContract.startDate}) 이후여야 합니다.`);
      return;
    }
    if (oldContract.endDate && oldContract.endDate !== '미정' && successionDate > oldContract.endDate) {
      showErrorModal(`승계일자(${successionDate})는 기존 계약 만료일(${oldContract.endDate}) 이전이어야 합니다.`);
      return;
    }

    const successorCust = db.customers.find(c => c.id === successorCustomerId);
    if (successorCust?.transactionStatus === 'BLOCKED') {
      showErrorModal(`인수 고객사(${successorCust.name})는 거래제한(출고차단) 상태이므로 계약을 승계할 수 없습니다.`);
      return;
    }

    const oldEndDate = oldContract.endDate;
    
    db.updateRow<Contract>('contracts', contractId, {
      endDate: successionDate,
      status: 'SHORTENED',
      updatedAt: new Date().toISOString()
    });

    const oldCAssets = db.contractAssets.filter(ca => ca.contractId === contractId);
    oldCAssets.forEach(ca => {
      db.updateRow<ContractAsset>('contractAssets', ca.id, { endDate: successionDate });
    });

    db.insertRow<ContractHistory>('contractHistory', {
      contractId,
      changeType: 'SHORTEN',
      changeDate: successionDate,
      prevEndDate: oldEndDate,
      newEndDate: successionDate,
      description: `계약 승계 이전(타 고객 인수)에 따른 단축 완료`,
      createdAt: new Date().toISOString()
    });

    const oldCustomer = db.customers.find(cust => cust.id === oldContract.customerId);
    const oldCustomerName = oldCustomer ? oldCustomer.name : '-';

    const nextDay = new Date(new Date(successionDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const newContractNo = generateNextContractNo();

    const newContract = db.insertRow<Contract>('contracts', {
      contractNo: newContractNo,
      customerId: successorCustomerId,
      contactId: successorContactId,
      siteId: successorSiteId,
      startDate: nextDay,
      endDate: oldEndDate,
      billingDay: oldContract.billingDay,
      statementClosingDay: oldContract.statementClosingDay,
      paymentDueDay: oldContract.paymentDueDay,
      lateInterestRate: oldContract.lateInterestRate || 0,
      salespersonId: oldContract.salespersonId,
      status: 'ACTIVE',
      predecessorContractId: oldContract.id,
      predecessorContractNo: oldContract.contractNo,
      predecessorCustomerId: oldContract.customerId,
      predecessorCustomerName: oldCustomerName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    db.updateRow<Contract>('contracts', contractId, {
      successorContractId: newContract.id,
      status: 'SUCCEEDED'
    });

    const nowIsoSucceed = new Date().toISOString();
    oldCAssets.forEach(ca => {
      const newCA = db.insertRow<ContractAsset>('contractAssets', {
        contractId: newContract.id,
        assetId: ca.assetId,
        monthlyRentalFee: ca.monthlyRentalFee,
        dailyRentalFee: ca.dailyRentalFee,
        startDate: nextDay,
        endDate: oldEndDate,
        createdAt: nowIsoSucceed
      });

      if (ca.assetId) {
        db.updateRow<Asset>('assets', ca.assetId, {
          currentCustomerId: successorCustomerId,
          currentSiteId: successorSiteId,
          contractStart: nextDay,
          contractEnd: oldEndDate,
          updatedAt: nowIsoSucceed
        });

        // ✅ 고아 레코드 방지: ASSIGNED(출고대기) 상태 자산 승계 시 신규 계약 기준 출고검수 의뢰 생성
        const asset = db.assets.find(a => a.id === ca.assetId);
        if (asset && asset.status === 'ASSIGNED') {
          db.insertRow<OutboundInspection>('outboundInspections', {
            contractId: newContract.id,
            contractAssetId: newCA.id,
            assetId: ca.assetId,
            status: 'PENDING',
            createdAt: nowIsoSucceed,
            updatedAt: nowIsoSucceed
          });
        }
      }
    });

    db.insertRow<ContractHistory>('contractHistory', {
      contractId: newContract.id,
      changeType: 'REGISTER',
      changeDate: successionDate,
      newEndDate: oldEndDate,
      description: `계약 승계 인수 완료 (이전 계약번호: ${oldContract.contractNo}): ${description}`,
      createdAt: new Date().toISOString()
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const assignAssetToContract = async (contractAssetId: string, assetId: string) => {
    // 💡 1. 롤백용 원본 스냅샷 백업
    const origCa = db.contractAssets.find(c => c.id === contractAssetId);
    const caSnapshot = origCa ? { ...origCa } : null;

    const origAsset = db.assets.find(a => a.id === assetId);
    const assetSnapshot = origAsset ? { ...origAsset } : null;

    let createdInspectionId: string | null = null;

    try {
      if (!origCa) throw new Error('해당 계약 슬롯(contractAsset)을 찾을 수 없습니다.');

      let contract = db.contracts.find(c => c.id === origCa.contractId);
      if (!contract && db.isSupabaseConnected()) {
        try {
          await db.pullTableFromSupabase('contracts');
          contract = db.contracts.find(c => c.id === origCa.contractId);
        } catch (e) {}
      }

      if (!origAsset) throw new Error('할당할 대상 장비를 찾을 수 없습니다.');

      const nowIso = new Date().toISOString();

      // 1. ContractAsset 업데이트 (실물 장비 ID 할당, 기존 계약의 expectedModel 보존)
      db.updateRow<ContractAsset>('contractAssets', contractAssetId, {
        assetId: assetId,
        expectedModel: origCa.expectedModel || origAsset?.modelName
      });

      // 2. Asset 상태 업데이트 (ASSIGNED 출고대기로 전환)
      const assetUpdatePayload: Partial<Asset> = {
        status: 'ASSIGNED',
        updatedAt: nowIso
      };
      if (contract?.customerId) assetUpdatePayload.currentCustomerId = contract.customerId;
      if (contract?.siteId) assetUpdatePayload.currentSiteId = contract.siteId;
      if (contract?.startDate) assetUpdatePayload.contractStart = contract.startDate;
      if (contract?.endDate) assetUpdatePayload.contractEnd = contract.endDate;

      db.updateRow<Asset>('assets', assetId, assetUpdatePayload);

      // 3. 출고 검수/정비 작업 의뢰 생성
      const createdInsp = db.insertRow<OutboundInspection>('outboundInspections', {
        contractId: origCa.contractId,
        contractAssetId: origCa.id,
        assetId: assetId,
        status: 'PENDING',
        createdAt: nowIso,
        updatedAt: nowIso
      });
      createdInspectionId = createdInsp.id;

      // 4. Supabase 원격 DB 쓰기 100% 완결 동기 대기 (실패 시 catch 블록에서 자동 롤백!)
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('assignAssetToContract error & Rollback:', err);

      // 💥 DB 저장 실패 시 로컬 DB 및 UI State를 100% 이전 상태로 자동 롤백 (Rollback Execution)!
      if (caSnapshot) {
        db.updateRow<ContractAsset>('contractAssets', contractAssetId, caSnapshot);
      }
      if (assetSnapshot) {
        db.updateRow<Asset>('assets', assetId, assetSnapshot);
      }
      if (createdInspectionId) {
        db.deleteRow('outboundInspections', createdInspectionId);
      }

      refreshAllData(); // 롤백된 원복 상태를 UI에 반영!

      const errMsg = err?.message || err?.details || JSON.stringify(err);
      showErrorModal(
        `⚠️ 장비 할당 저장 중 DB 동기화 오류가 발생했습니다:\n\n` +
        `■ [안내]: 저장 실패로 인해 장비 할당 상태가 이전 미할당 상태로 안전하게 롤백(자동 원복)되었습니다. 할당 대상 목록에서 계속 작업하실 수 있습니다.\n\n` +
        `■ [실패 원인]: ${errMsg}`,
        '장비 할당 DB 동기화 오류 (자동 롤백 원복 완료)'
      );
      throw err;
    }
  };

  // 🚀 다중 장비 원자적 일괄 할당 트랜잭션 메소드 (중간 리렌더링 및 레이스 컨디션 원천 차단)
  const batchAssignAssetsToContract = async (pairs: { contractAssetId: string; assetId: string }[]) => {
    if (!pairs || pairs.length === 0) return;

    // 롤백용 전체 스냅샷 준비
    const caSnapshots: { id: string; snapshot: ContractAsset }[] = [];
    const assetSnapshots: { id: string; snapshot: Asset }[] = [];
    const createdInspectionIds: string[] = [];

    const nowIso = new Date().toISOString();

    try {
      // 1. 사전 검증 및 스냅샷 백업
      for (const pair of pairs) {
        const origCa = db.contractAssets.find(c => c.id === pair.contractAssetId);
        if (!origCa) throw new Error(`계약 슬롯(${pair.contractAssetId})을 찾을 수 없습니다.`);
        caSnapshots.push({ id: origCa.id, snapshot: { ...origCa } });

        const origAsset = db.assets.find(a => a.id === pair.assetId);
        if (!origAsset) throw new Error(`대상 장비(${pair.assetId})를 찾을 수 없습니다.`);
        assetSnapshots.push({ id: origAsset.id, snapshot: { ...origAsset } });
      }

      // 2. 전체 슬롯 및 자산 일괄 메모리 업데이트 (단일 원자적 배치)
      for (const pair of pairs) {
        const origCa = db.contractAssets.find(c => c.id === pair.contractAssetId)!;
        const origAsset = db.assets.find(a => a.id === pair.assetId)!;
        const contract = db.contracts.find(c => c.id === origCa.contractId);

        // 2-1. contractAssets 업데이트 (기존 계약의 expectedModel 절대 보존)
        db.updateRow<ContractAsset>('contractAssets', origCa.id, {
          assetId: origAsset.id,
          expectedModel: origCa.expectedModel || origAsset.modelName
        });

        // 2-2. assets 업데이트
        const assetUpdatePayload: Partial<Asset> = {
          status: 'ASSIGNED',
          updatedAt: nowIso
        };
        if (contract?.customerId) assetUpdatePayload.currentCustomerId = contract.customerId;
        if (contract?.siteId) assetUpdatePayload.currentSiteId = contract.siteId;
        if (contract?.startDate) assetUpdatePayload.contractStart = contract.startDate;
        if (contract?.endDate) assetUpdatePayload.contractEnd = contract.endDate;

        db.updateRow<Asset>('assets', origAsset.id, assetUpdatePayload);

        // 2-3. 출고 검수 의뢰 생성
        const createdInsp = db.insertRow<OutboundInspection>('outboundInspections', {
          contractId: origCa.contractId,
          contractAssetId: origCa.id,
          assetId: origAsset.id,
          status: 'PENDING',
          createdAt: nowIso,
          updatedAt: nowIso
        });
        // 2-4. 🌟 [패키지 서류 무결성]: 기존 슬롯에 다른 장비가 배정되어 있었는데 교체된 경우 ToDo 발행
        if (origCa.assetId && origCa.assetId !== origAsset.id) {
          try {
            await checkAndIssuePackageResendTask({
              contractId: origCa.contractId,
              oldAssetId: origCa.assetId,
              newAssetId: origAsset.id,
              reason: '출고 전 장비 재할당/교체',
              senderName: '장비할당시스템'
            });
          } catch (taskErr) {
            console.warn('계약서패키지 재발송 ToDo 발행 경고 (무시):', taskErr);
          }
        }
      }

      // 3. 단 1회의 원격 DB 쓰기 완결 동기 대기 & 단 1회의 전역 리렌더링!
      await db.awaitPendingWrites();
      refreshAllData();

    } catch (err: any) {
      console.error('batchAssignAssetsToContract error & Rollback:', err);

      // 💥 일괄 롤백
      caSnapshots.forEach(item => {
        db.updateRow<ContractAsset>('contractAssets', item.id, item.snapshot);
      });
      assetSnapshots.forEach(item => {
        db.updateRow<Asset>('assets', item.id, item.snapshot);
      });
      createdInspectionIds.forEach(id => {
        db.deleteRow('outboundInspections', id);
      });

      refreshAllData();

      const errMsg = err?.message || err?.details || JSON.stringify(err);
      showErrorModal(`⚠️ 일괄 장비 할당 중 오류가 발생하여 모든 작업이 안전하게 원복되었습니다:\n\n${errMsg}`, '일괄 장비 할당 실패');
      throw err;
    }
  };

  // 🔄 장비 할당 취소 메소드 (출고 검수 전 슬롯 할당 해제 및 장비 AVAILABLE 복원)
  const unassignAssetFromContract = async (contractAssetId: string) => {
    const origCa = db.contractAssets.find(c => c.id === contractAssetId);
    if (!origCa || !origCa.assetId) return;

    const origAssetId = origCa.assetId;
    const origAsset = db.assets.find(a => a.id === origAssetId);

    const caSnapshot = { ...origCa };
    const assetSnapshot = origAsset ? { ...origAsset } : null;

    try {
      const nowIso = new Date().toISOString();

      // 1. ContractAsset 에서 assetId 명시적 NULL 제거 (Supabase DB 반영 보장)
      db.updateRow<ContractAsset>('contractAssets', contractAssetId, {
        assetId: null as any
      });

      // 2. Asset 상태를 AVAILABLE (임대가능) 로 복원 및 계약 연결 명시적 NULL 해제
      if (origAsset) {
        db.updateRow<Asset>('assets', origAssetId, {
          status: 'AVAILABLE',
          currentCustomerId: null as any,
          currentSiteId: null as any,
          contractStart: null as any,
          contractEnd: null as any,
          updatedAt: nowIso
        });
      }

      // 3. 아직 대기 중(PENDING)인 출고 검수 의뢰건 전체 삭제
      const pendingInsps = db.outboundInspections.filter(
        i => (i.contractAssetId === contractAssetId || (i.contractId === origCa.contractId && i.assetId === origAssetId)) && i.status === 'PENDING'
      );
      pendingInsps.forEach(i => db.deleteRow('outboundInspections', i.id));

      // 4. 🌟 [패키지 서류 무결성]: 계약서패키지 발송 후 출고 전 장비 할당 해제 시 ToDo 자동 발행
      try {
        await checkAndIssuePackageResendTask({
          contractId: origCa.contractId,
          oldAssetId: origAssetId,
          newAssetId: undefined,
          reason: '출고 전 장비 할당 해제/취소',
          senderName: '장비할당시스템'
        });
      } catch (taskErr) {
        console.warn('계약서패키지 재발송 ToDo 발행 경고 (무시):', taskErr);
      }

      // 5. DB 완결 동기 대기 & 전역 리렌더링
      await db.awaitPendingWrites();
      refreshAllData();

    } catch (err: any) {
      console.error('unassignAssetFromContract error & Rollback:', err);
      // 롤백
      db.updateRow<ContractAsset>('contractAssets', contractAssetId, caSnapshot);
      if (assetSnapshot && origAssetId) {
        db.updateRow<Asset>('assets', origAssetId, assetSnapshot);
      }
      refreshAllData();

      showErrorModal(`⚠️ 장비 할당 취소 중 오류가 발생하여 원복되었습니다:\n${err?.message || err}`, '할당 취소 실패');
      throw err;
    }
  };

  // 🔄 다중 장비 원자적 일괄 할당 취소 트랜잭션 메소드 (중간 리렌더링 및 레이스 컨디션 원천 차단)
  const batchUnassignAssetsFromContract = async (contractAssetIds: string[]) => {
    if (!contractAssetIds || contractAssetIds.length === 0) return;

    const caSnapshots: { id: string; snapshot: ContractAsset }[] = [];
    const assetSnapshots: { id: string; snapshot: Asset }[] = [];
    const deletedInspectionIds: { id: string; row: OutboundInspection }[] = [];

    const nowIso = new Date().toISOString();

    try {
      // 1. 사전 검증 및 스냅샷 백업
      for (const caId of contractAssetIds) {
        const origCa = db.contractAssets.find(c => c.id === caId);
        if (origCa && origCa.assetId) {
          caSnapshots.push({ id: origCa.id, snapshot: { ...origCa } });
          const origAsset = db.assets.find(a => a.id === origCa.assetId);
          if (origAsset) {
            assetSnapshots.push({ id: origAsset.id, snapshot: { ...origAsset } });
          }
          const pendingInsp = db.outboundInspections.find(
            i => (i.contractAssetId === caId || (i.contractId === origCa.contractId && i.assetId === origCa.assetId)) && i.status === 'PENDING'
          );
          if (pendingInsp) {
            deletedInspectionIds.push({ id: pendingInsp.id, row: { ...pendingInsp } });
          }
        }
      }

      // 2. 일괄 메모리 업데이트 (단일 원자적 배치)
      for (const caId of contractAssetIds) {
        const origCa = db.contractAssets.find(c => c.id === caId);
        if (origCa && origCa.assetId) {
          const origAssetId = origCa.assetId;
          db.updateRow<ContractAsset>('contractAssets', caId, {
            assetId: null as any
          });
          db.updateRow<Asset>('assets', origAssetId, {
            status: 'AVAILABLE',
            currentCustomerId: null as any,
            currentSiteId: null as any,
            contractStart: null as any,
            contractEnd: null as any,
            updatedAt: nowIso
          });
          const pendingInsps = db.outboundInspections.filter(
            i => (i.contractAssetId === caId || (i.contractId === origCa.contractId && i.assetId === origAssetId)) && i.status === 'PENDING'
          );
          pendingInsps.forEach(i => {
            deletedInspectionIds.push({ id: i.id, row: { ...i } });
            db.deleteRow('outboundInspections', i.id);
          });
        }
      }

      // 3. 단 1회의 원격 DB 쓰기 완결 동기 대기 & 단 1회의 전역 리렌더링!
      await db.awaitPendingWrites();
      refreshAllData();

    } catch (err: any) {
      console.error('batchUnassignAssetsFromContract error & Rollback:', err);
      // 💥 일괄 롤백
      caSnapshots.forEach(item => {
        db.updateRow<ContractAsset>('contractAssets', item.id, item.snapshot);
      });
      assetSnapshots.forEach(item => {
        db.updateRow<Asset>('assets', item.id, item.snapshot);
      });
      deletedInspectionIds.forEach(item => {
        db.insertRow<OutboundInspection>('outboundInspections', item.row);
      });
      refreshAllData();

      showErrorModal(`⚠️ 일괄 장비 할당 취소 중 오류가 발생하여 모든 작업이 안전하게 원복되었습니다:\n\n${err?.message || err}`, '일괄 할당 취소 실패');
      throw err;
    }
  };

  // 💡 출고 진행 중 장비 교체 및 수리전환 트랜잭션 메소드 (contractAssetId 또는 contractId 2중 자동추적 지원)
  const exchangeOutboundAsset = async (
    contractAssetIdOrContractId: string,
    oldAssetId: string,
    newAssetId: string,
    reason?: string,
    markOldAsRepairing: boolean = true,
    customPenaltyScore?: number
  ) => {
    // 롤백용 스냅샷 준비
    const oldAssetOrig = db.assets.find(a => a.id === oldAssetId);
    const newAssetOrig = db.assets.find(a => a.id === newAssetId);
    
    // contractAssetId 직접 매칭 또는 contractId + oldAssetId 조합으로 2중 유연 추적
    let caOrig = db.contractAssets.find(c => c.id === contractAssetIdOrContractId);
    if (!caOrig) {
      caOrig = db.contractAssets.find(c => c.contractId === contractAssetIdOrContractId && (c.assetId === oldAssetId || !c.assetId));
    }
    if (!caOrig) {
      caOrig = db.contractAssets.find(c => c.contractId === contractAssetIdOrContractId);
    }
    const contractAssetId = caOrig?.id || contractAssetIdOrContractId;

    const inspOrig = db.outboundInspections.find(i => (i.contractAssetId === contractAssetId || i.contractId === contractAssetIdOrContractId) && i.assetId === oldAssetId);

    const oldSnapshot = oldAssetOrig ? { ...oldAssetOrig } : null;
    const newSnapshot = newAssetOrig ? { ...newAssetOrig } : null;
    const caSnapshot = caOrig ? { ...caOrig } : null;
    const inspSnapshot = inspOrig ? { ...inspOrig } : null;
    let createdRepairId: string | undefined = undefined;

    try {
      if (!oldAssetOrig || !newAssetOrig || !caOrig) {
        throw new Error(`교체 대상 장비 또는 계약 슬롯을 찾을 수 없습니다. (구장비: ${oldAssetId ? '정상' : '누락'}, 신장비: ${newAssetId ? '정상' : '누락'}, 계약슬롯: ${caOrig ? '정상' : '누락'})`);
      }

      const today = new Date().toISOString().split('T')[0];
      const nowIso = new Date().toISOString();

      // 1. 기존 장비: 수리정비중(REPAIRING) 선택 시 REPAIRING 전환, 아니면 임대가능(AVAILABLE) 유지!
      // 💡 [전사 정책]: 출고검수 탈락 교체 시 사유 유무와 무관하게 정비점수 가산 (지정 점수 또는 기본 5점)
      const targetStatus = markOldAsRepairing ? 'REPAIRING' : 'AVAILABLE';
      const penaltyToAdd = typeof customPenaltyScore === 'number' && !isNaN(customPenaltyScore) ? customPenaltyScore : 5;
      const updatedScore = (Number(oldAssetOrig.maintenanceScore) || 0) + penaltyToAdd;
      
      const cleanReason = reason && reason.trim() ? reason.trim() : '출고검수 탈락 교체(사유미기재)';
      const oldNote = oldAssetOrig.note || '';
      const appendedNote = oldNote
        ? `${oldNote}\n[출고검수 교체(벌점+${penaltyToAdd}, 총점:${updatedScore}점)] ${today}: ${cleanReason}`
        : `[출고검수 교체(벌점+${penaltyToAdd}, 총점:${updatedScore}점)] ${today}: ${cleanReason}`;

      const oldPayload: Partial<Asset> = {
        status: targetStatus,
        maintenanceScore: updatedScore,
        currentCustomerId: undefined,
        currentSiteId: undefined,
        contractStart: undefined,
        contractEnd: undefined,
        note: appendedNote, // 🌟 자산 정비필요항목(note)에만 정확히 저장
        // 🌟 memo(일반 자산 비고: 임차처/결제조건 등)는 절대 오염시키지 않고 원본 100% 보존!
        updatedAt: nowIso
      };

      db.updateRow<Asset>('assets', oldAssetId, oldPayload);

      // 1-1. 🌟 [주기장 정비 연계]: 수리정비중 전환 시 주기장 정비 대장(repairs) 티켓 1:1 자동 발행 (헌장 1.2 무누락 저장)
      if (markOldAsRepairing) {
        createdRepairId = db.generateNextId('repairs', db.repairs);
        db.insertRow<Repair>('repairs', {
          id: createdRepairId,
          assetId: oldAssetId,
          assetNo: oldAssetOrig.assetNo,
          modelName: oldAssetOrig.modelName,
          contractId: caOrig.contractId,
          customerId: oldAssetOrig.currentCustomerId,
          customerName: db.customers.find(c => c.id === oldAssetOrig.currentCustomerId)?.name || '출고 검수처',
          siteId: oldAssetOrig.currentSiteId,
          siteName: db.sites.find(s => s.id === oldAssetOrig.currentSiteId)?.name || '주기장',
          requestDate: today,
          status: 'PENDING',
          workCategory: 'YARD_INTERNAL',
          workLocation: 'YARD',
          stockSource: 'YARD_STOCK',
          source: 'OUTBOUND_DEFECT',
          repairType: 'INTERNAL',
          priority: 'URGENT',
          details: `[출고검수 불량 정비 접수] 교체사유: ${cleanReason}\n대체장비: ${newAssetOrig.assetNo} (${newAssetOrig.modelName})`,
          issueDescription: cleanReason,
          totalCost: 0,
          billableToCustomer: false,
          targetAssetStatus: 'REPAIRING',
          degradationScore: penaltyToAdd,
          createdAt: nowIso,
          updatedAt: nowIso
        });

        // 🚀 주기장 정비팀에 긴급 정비 ToDo 자동 적재
        try {
          await issueHandoverTask({
            category: 'OUTBOUND_REPAIR_DEFECT',
            title: `[출고 교체 긴급 정비] ${oldAssetOrig.assetNo} (${oldAssetOrig.modelName})`,
            content: `출고검수 불량 교체 (+${penaltyToAdd}점): ${cleanReason} (대체: ${newAssetOrig.assetNo})`,
            targetDept: 'YARD',
            priority: 'URGENT',
            actionUrl: '/repairs',
            entityType: 'REPAIR',
            entityId: createdRepairId,
            senderId: currentUser?.id,
            senderName: currentUser?.name || '출고검수시스템'
          });
        } catch (taskErr) {
          console.warn('출고 불량 정비 ToDo 발행 경고 (무시):', taskErr);
        }
      }

      // 2. 대체 장비: 배차지정(ASSIGNED)으로 전환 및 계약 정보 매핑
      db.updateRow<Asset>('assets', newAssetId, {
        status: 'ASSIGNED',
        currentCustomerId: oldAssetOrig.currentCustomerId,
        currentSiteId: oldAssetOrig.currentSiteId,
        contractStart: oldAssetOrig.contractStart,
        contractEnd: oldAssetOrig.contractEnd,
        updatedAt: nowIso
      });

      // 3. 계약 슬롯(contractAssets) assetId 교체
      db.updateRow<ContractAsset>('contractAssets', contractAssetId, {
        assetId: newAssetId,
        expectedModel: newAssetOrig.modelName
      });

      // 4. 출고 검수 의뢰건(outboundInspections) assetId 교체 (없으면 신규 생성하여 검수 누락 방지)
      if (inspOrig) {
        db.updateRow<OutboundInspection>('outboundInspections', inspOrig.id, {
          assetId: newAssetId,
          note: `[장비교체] 기존(${oldAssetOrig.assetNo}) ➔ 대체(${newAssetOrig.assetNo}) | 사유: ${reason}`,
          updatedAt: nowIso
        });
      } else {
        db.insertRow<OutboundInspection>('outboundInspections', {
          id: `insp-${contractAssetId}-${Date.now()}`,
          contractId: caOrig.contractId,
          contractAssetId,
          assetId: newAssetId,
          status: 'PENDING',
          note: `[장비교체] 대체(${newAssetOrig.assetNo}) 신규 검수의뢰 | 사유: ${reason}`,
          createdAt: nowIso,
          updatedAt: nowIso
        });
      }

      // 5. 자산 입출고/수리 타임라인 로깅 (대체 장비는 향후 출고 검수 승인 시 OUTBOUND 이력이 생성됨)
      db.insertRow<AssetInOutLog>('assetInOutLogs', {
        assetId: oldAssetId,
        assetNo: oldAssetOrig.assetNo,
        modelName: oldAssetOrig.modelName,
        type: 'REPAIR',
        repairId: createdRepairId,
        eventDate: today,
        memo: `[출고불가 수리전환] 대체장비(${newAssetOrig.assetNo}) 교체배정 | 사유: ${cleanReason}${createdRepairId ? ` (정비티켓 ${createdRepairId} 자동발행)` : ''}`,
        createdAt: nowIso
      });

      // 6. 🌟 [패키지 서류 무결성 보존]: 계약서패키지 발송 후 출고 자산 교체 시 ToDo 자동 발행
      try {
        await checkAndIssuePackageResendTask({
          contractId: caOrig.contractId,
          oldAssetId,
          newAssetId,
          reason,
          senderName: '출고검수시스템'
        });
      } catch (taskErr) {
        console.warn('계약서패키지 재발송 ToDo 발행 경고 (무시):', taskErr);
      }

      // 7. DB 완결 동기 대기 (실패 시 catch 블록에서 자동 롤백!)
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      console.error('exchangeOutboundAsset error & Rollback:', err);

      // 💥 DB 저장 실패 시 100% 스냅샷 롤백!
      if (oldSnapshot) db.updateRow('assets', oldAssetId, oldSnapshot);
      if (newSnapshot) db.updateRow('assets', newAssetId, newSnapshot);
      if (caSnapshot) db.updateRow('contractAssets', contractAssetId, caSnapshot);
      if (inspSnapshot && inspOrig) db.updateRow('outboundInspections', inspOrig.id, inspSnapshot);
      if (createdRepairId) db.deleteRow('repairs', createdRepairId);

      refreshAllData();

      const errorMsg = `⚠️ 출고 장비 교체 처리 중 DB 동기화 오류가 발생했습니다:\n\n■ [안내]: 저장 실패로 인해 장비 교체 작업이 안전하게 자동 롤백 원복되었습니다.\n\n${err.message || err.details || JSON.stringify(err)}`;
      showErrorModal(errorMsg, '출고 장비 교체 DB 동기화 오류');
      throw err;
    }
  };

  const exchangeAsset = async (contractId: string, oldAssetId: string, newAssetId: string, exchangeDate: string) => {
    try {
      const contract = db.contracts.find(c => c.id === contractId);
      if (!contract) {
        showErrorModal('대차 교체 대상 계약 정보를 찾을 수 없습니다.');
        return;
      }

      const caList = db.contractAssets.filter(ca => ca.contractId === contractId && ca.assetId === oldAssetId);
      const ca = caList.find(c => !c.endDate || new Date(c.endDate) >= new Date(exchangeDate));
      if (!ca) {
        showErrorModal('대차 대상 계약 자산 슬롯을 찾을 수 없습니다.');
        return;
      }

      const originalEndDate = ca.endDate;
      const prevDateObj = new Date(exchangeDate);
      prevDateObj.setDate(prevDateObj.getDate() - 1);
      const dayBeforeExchange = prevDateObj.toISOString().split('T')[0];

      // 헌장 4.1: 전자산은 교체 전일까지 일할 마감
      db.updateRow<ContractAsset>('contractAssets', ca.id, { 
        endDate: dayBeforeExchange,
        status: 'RETURNED',
        actualReturnDate: exchangeDate,
        updatedAt: new Date().toISOString()
      });

      const oldAsset = db.assets.find(a => a.id === oldAssetId);
      if (oldAsset) {
        db.updateRow<Asset>('assets', oldAssetId, {
          status: 'REPAIRING',
          currentCustomerId: undefined,
          currentSiteId: undefined,
          contractStart: undefined,
          contractEnd: undefined,
          updatedAt: new Date().toISOString()
        });
      }

      // 헌장 4.1: 후장비는 교체 당일부터 가동 승계
      const newAsset = db.assets.find(a => a.id === newAssetId);
      if (newAsset) {
        db.insertRow<ContractAsset>('contractAssets', {
          contractId: contractId,
          assetId: newAssetId,
          monthlyRentalFee: ca.monthlyRentalFee,
          dailyRentalFee: ca.dailyRentalFee,
          startDate: exchangeDate,
          endDate: originalEndDate || contract.endDate,
          createdAt: new Date().toISOString()
        });

        // 헌장 1.3 준수: 배차 단계에서는 ASSIGNED(배정/출고대기) 상태 부여, 출고 검수 승인 마감 시 RENTED 전환
        db.updateRow<Asset>('assets', newAssetId, {
          status: 'ASSIGNED',
          currentCustomerId: contract.customerId,
          currentSiteId: contract.siteId,
          contractStart: exchangeDate,
          contractEnd: originalEndDate || contract.endDate,
          monthlyRentalFee: ca.monthlyRentalFee,
          dailyRentalFee: ca.dailyRentalFee,
          updatedAt: new Date().toISOString()
        });
      }

      // 헌장 2.3 준수: 단일 EXCHANGE 배차 의뢰 1건 발행
      db.insertRow<Delivery>('deliveries', {
        contractId: contractId,
        type: 'EXCHANGE',
        status: 'REQUESTED',
        requestDate: exchangeDate,
        deliveryCost: 0,
        isCostSettled: false,
        memo: `장비 교체 의뢰 (구: ${oldAsset?.assetNo || '미상'} -> 신: ${newAsset?.assetNo || '미상'})`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 헌장 4.2 준수: changeType 'EXCHANGE' 명시
      db.insertRow<ContractHistory>('contractHistory', {
        contractId,
        changeType: 'EXCHANGE',
        changeDate: exchangeDate,
        description: `장비 교체 완료 (구: ${oldAsset?.assetNo || '미상'} -> 신: ${newAsset?.assetNo || '미상'})`,
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 대차 교체 처리 중 DB 동기화 오류:\n${err?.message || err}`);
      throw err;
    }
  };

  const generateBillingsForMonth = async (billingYm: string, billingDate: string) => {
    try {
      const [year, month] = billingYm.split('-').map(Number);
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0);

      // 해당 월에 활성 상태인 계약 전체 탐색 (계약 단위 독립 생성 - E-1 원칙, 매각 계약 원천 배제)
      const activeContracts = db.contracts.filter(c => {
        if ((c.contractType || 'RENTAL') !== 'RENTAL') return false; // 🚫 자산 매각 계약(SALE) 원천 배제
        if (c.status === 'COMPLETED') return false;
        const contractStart = new Date(c.startDate);
        const contractEnd = c.endDate ? new Date(c.endDate) : null;
        if (contractStart > endOfMonth) return false;
        if (contractEnd && contractEnd < startOfMonth) return false;
        return true;
      });

      let createdCount = 0;
      const errors: string[] = [];

      for (const c of activeContracts) {
        try {
          const bId = await generateBillingForSingleContract(c.id, billingYm, billingDate);
          if (bId) createdCount++;
        } catch (err: any) {
          // 중복 경고는 조용히 skip (이미 존재하는 청구서)
          if (err?.message?.includes('[중복 경고]')) continue;
          errors.push(err?.message || String(err));
        }
      }

      await db.awaitPendingWrites();
      refreshAllData();

      if (errors.length > 0) {
        showErrorModal(`⚠️ 일부 청구서 생성 실패 (${errors.length}건):\n\n${errors.slice(0, 5).join('\n')}`, '청구서 생성 일부 실패');
      }
    } catch (err: any) {
      showErrorModal(`⚠️ 일괄 청구서 DB 저장 실패:\n\n${err?.message || err}`, '청구서 생성 실패');
    }
  };

  // 거래명세서 발송: UNPAID → REQUESTED (F-2 원칙)
  const approveBilling = async (billingId: string) => {
    const billing = db.billings.find(b => b.id === billingId);
    if (!billing) return;
    if (billing.status === 'UNPAID') {
      // 발송 처리: REQUESTED로 전환
      db.updateRow<Billing>('billings', billingId, {
        status: 'REQUESTED',
        updatedAt: new Date().toISOString()
      });
      // 계약이력 기록
      if (billing.contractId) {
        db.insertRow<ContractHistory>('contractHistory', {
          contractId: billing.contractId,
          changeType: 'BILLING_SENT',
          changeDate: new Date().toISOString().split('T')[0],
          description: `청구서 발송: ${billing.billingYm} / ${billing.totalAmount.toLocaleString()}원 (청구번호: ${billingId})`,
          createdAt: new Date().toISOString()
        });
      }
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 청구 취소 (J-1, J-2 원칙)
  // refund=true: 수납 취소 + 입금잔액 소멸 (환불 케이스)
  // refund=false: 청구만 취소, 수납·입금잔액 잔류 (비환불 케이스 → 새 청구에 연결)
  const cancelBilling = async (billingId: string, refund: boolean = false) => {
    const billing = db.billings.find(b => b.id === billingId);
    if (!billing) return;

    const details = db.billingDetails.filter(bd => bd.billingId === billingId);

    // 선수금·누적렌탈료 롤백
    details.forEach(bd => {
      if (bd.itemName === '선수금(예치금) 차감 반영') {
        const customer = db.customers.find(c => c.id === billing.customerId);
        if (customer) {
          db.updateRow<Customer>('customers', customer.id, {
            prepaidBalance: (customer.prepaidBalance || 0) + Math.abs(bd.amount),
            updatedAt: new Date().toISOString()
          } as any);
        }
      }
      if (bd.contractAssetId) {
        const ca = db.contractAssets.find(x => x.id === bd.contractAssetId);
        if (ca) {
          const assetInfo = db.assets.find(a => a.id === ca.assetId);
          if (assetInfo) {
            db.updateRow<Asset>('assets', assetInfo.id, {
              cumRentalFee: Math.max(0, (assetInfo.cumRentalFee || 0) - bd.amount),
              updatedAt: new Date().toISOString()
            });
          }
        }
      }
      // 외상미수금 연동 해제 (billedAmount 롤백)
      if (bd.receivableId) {
        const rcv = db.receivables.find(r => r.id === bd.receivableId);
        if (rcv) {
          const newBilled = Math.max(0, rcv.billedAmount - bd.amount);
          db.updateRow<Receivable>('receivables', rcv.id, {
            billedAmount: newBilled,
            status: newBilled <= 0 ? 'PENDING' : newBilled < rcv.totalAmount ? 'PARTIAL' : 'CLEARED',
            updatedAt: new Date().toISOString()
          });
        }
      }
    });

    if (refund) {
      // 환불 케이스: 수납 취소 + payment_deposit_links 해제
      const linkedPayments = db.payments.filter(p => p.billingId === billingId);
      linkedPayments.forEach(p => {
        db.paymentDepositLinks
          .filter(l => l.paymentId === p.id)
          .forEach(l => db.deleteRow('paymentDepositLinks', l.id));
        db.deleteRow('payments', p.id);
      });
    }
    // 비환불 케이스: 수납·입금잔액 그대로 유지 → 새 청구 생성 시 FIFO로 자동 연결

    // 공통: 청구 상세 삭제 후 청구 REJECTED 처리 (완전 삭제 대신 이력 보존)
    details.forEach(bd => db.deleteRow('billingDetails', bd.id));
    db.updateRow<Billing>('billings', billingId, {
      status: 'REJECTED',
      updatedAt: new Date().toISOString()
    });

    // 계약이력 기록
    if (billing.contractId) {
      db.insertRow<ContractHistory>('contractHistory', {
        contractId: billing.contractId,
        changeType: 'BILLING_CANCELLED',
        changeDate: new Date().toISOString().split('T')[0],
        description: `청구 취소: ${billing.billingYm} / ${billing.totalAmount.toLocaleString()}원 (${refund ? '환불 처리' : '비환불 처리'}, 청구번호: ${billingId})`,
        createdAt: new Date().toISOString()
      });
      // 💡 청구 취소 시 계약 메타데이터 이전 상태로 롤백 동기화
      syncContractBillingMilestones(billing.contractId);
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  // ─── 외상미수금 CRUD (4단계) ──────────────────────────────────────────────

  /** 외상미수금 신규 등록 */
  const addReceivable = (data: Omit<Receivable, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newRcv = db.insertRow<Receivable>('receivables', {
      ...data,
      createdAt: now,
      updatedAt: now
    });
    refreshAllData();
    return newRcv.id;
  };

  /** 외상미수금 → 청구 상세 연동 (이번 달 청구할 금액 지정) */
    const linkReceivableToBilling = async (
    billingId: string,
    receivableId: string,
    amount: number,
    displayName?: string
  ) => {
    const rcv = db.receivables.find(r => r.id === receivableId);
    if (!rcv) throw new Error('외상미수금 항목을 찾을 수 없습니다.');

    const remaining = rcv.totalAmount - rcv.billedAmount;
    if (amount > remaining + 1) { // 부동소수점 오차 허용
      throw new Error(`청구 금액(${amount.toLocaleString()}원)이 미청구 잔액(${remaining.toLocaleString()}원)을 초과합니다.`);
    }

    const newBilled = rcv.billedAmount + amount;
    const newRemaining = rcv.totalAmount - newBilled;
    
    // K-3: 고객 투명성 확보를 위한 강제 트래커 텍스트 생성
    const trackerText = `[총 청구대상: ${rcv.totalAmount.toLocaleString()}원 / 금회 청구: ${amount.toLocaleString()}원 / 미청구 잔액: ${Math.max(0, newRemaining).toLocaleString()}원]`;

    const now = new Date().toISOString();
    db.insertRow<BillingDetail>('billingDetails', {
      billingId,
      receivableId,
      itemName: displayName || rcv.internalDescription,
      quantity: 1,
      unitPrice: amount,
      amount,
      description: trackerText,
      internalDescription: rcv.internalDescription,
      displayName: displayName || rcv.displayName,
      createdAt: now,
      updatedAt: now
    });

    db.updateRow<Receivable>('receivables', receivableId, {
      billedAmount: newBilled,
      status: newBilled >= rcv.totalAmount ? 'CLEARED' : 'PARTIAL',
      updatedAt: now
    });

    // 청구서 총액 갱신
    const billing = db.billings.find(b => b.id === billingId);
    if (billing) {
      db.updateRow<Billing>('billings', billingId, {
        totalAmount: billing.totalAmount + amount,
        updatedAt: now
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  /** K-2: 외상미수금 단독 청구서 발행 (수금 기동성 및 진상고객 방어) */
  const generateStandaloneBillingForReceivable = async (receivableId: string, reason: string): Promise<string> => {
    const rcv = db.receivables.find(r => r.id === receivableId);
    if (!rcv) throw new Error('외상미수금 항목을 찾을 수 없습니다.');
    if (rcv.status === 'CLEARED') throw new Error('이미 청구가 완료된 건입니다.');
    if (!rcv.customerId) throw new Error('고객 정보가 없는 미수금은 단독 청구할 수 없습니다.');

    const remaining = rcv.totalAmount - rcv.billedAmount;
    const now = new Date().toISOString();
    const billingYm = now.substring(0, 7);
    const billingDate = now.split('T')[0];

    // 결정: rcv.type에 따라 적절한 billingType 매핑 (Gap 2 방어)
    let bType: BillingType = 'REPAIR';
    if (rcv.type === 'TRANSPORT') bType = 'TRANSPORT';
    else if (rcv.type === 'CLEANING' || rcv.type === 'REPAIR') bType = 'REPAIR';
    else if (rcv.type === 'VENDOR_CLAIM' || rcv.type === 'OTHER') bType = 'REPAIR';

    const newBilling = db.insertRow<Billing>('billings', {
      billingType: bType,
      customerId: rcv.customerId,
      contractId: rcv.contractId || (null as any),
      billingYm,
      billingDate,
      totalAmount: 0, // linkReceivableToBilling이 갱신함
      paidAmount: 0,
      status: 'UNPAID',
      createdAt: now,
      updatedAt: now
    });

    const standaloneTitle = `[단독 청구 - ${reason}] ${rcv.displayName || rcv.internalDescription}`;
    await linkReceivableToBilling(newBilling.id, rcv.id, remaining, standaloneTitle);
    
    return newBilling.id;
  };

  const getDueContractsForBilling = (targetDate?: string) => {
    const todayStr = targetDate || new Date().toISOString().split('T')[0];
    const [year, month, day] = todayStr.split('-').map(Number);
    const targetYm = todayStr.slice(0, 7);
    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0);
    const lastDayOfMonth = endOfMonth.getDate();

    // 1. 유효 계약 탐색: 완료되지 않은 살아있는 렌탈 계약 (매각 계약 원천 배제)
    const liveContracts = db.contracts.filter(c => {
      if ((c.contractType || 'RENTAL') !== 'RENTAL') return false; // 🚫 자산 매각 계약(SALE) 원천 배제
      if (c.status === 'COMPLETED') return false;
      const cStart = new Date(c.startDate);
      if (cStart > endOfMonth) return false;
      if (c.endDate) {
        const cEnd = new Date(c.endDate);
        if (cEnd < startOfMonth) return false;
      }
      return true;
    });

    const dueList: { contract: Contract; customer: Customer; site?: CustomerSite; billingDay: number; dueReason: string }[] = [];

    liveContracts.forEach(c => {
      const cust = db.customers.find(cu => cu.id === c.customerId);
      if (!cust) return;
      const site = db.sites.find(s => s.id === c.siteId);

      // 💡 [Gap 1 방어] 이미 해당 귀속월(targetYm)에 유효한 '정기 렌탈료(RENTAL)' 청구서가 있는지 확인
      // 수리비(REPAIR), 운반비(TRANSPORT), 자산매각(ASSET_SALE) 단독 청구서와 엄격 분리
      const existingBilling = db.billings.find(b => 
        b.contractId === c.id && 
        b.billingYm === targetYm && 
        (b.billingType === 'RENTAL' || !b.billingType) && 
        b.status !== 'REJECTED'
      );
      if (existingBilling) return;

      // 고객/계약의 청구 기준일(billingDay) 또는 거래명세서 마감일(statementClosingDay)
      const rawBillingDay = c.billingDay || cust.defaultBillingDay || 31;
      const rawStatementDay = c.statementClosingDay || cust.defaultStatementClosingDay || rawBillingDay;
      const effectiveBillingDay = Math.min(rawBillingDay, lastDayOfMonth);
      const effectiveStatementDay = Math.min(rawStatementDay, lastDayOfMonth);
      const triggerDay = Math.min(effectiveBillingDay, effectiveStatementDay);

      // 💡 계약 시작일이 당월 마감일(triggerDay)보다 미래인 경우: 당월 청구 대상이 아니므로 제외 (익월 청구로 이관)
      const closingDateStr = `${year}-${String(month).padStart(2, '0')}-${String(triggerDay).padStart(2, '0')}`;
      if (c.startDate > closingDateStr) {
        return;
      }

      const isDayPassed = day >= triggerDay;
      const isPastMonthContract = new Date(c.startDate) < startOfMonth;

      if (isDayPassed || isPastMonthContract) {
        let reason = '';
        if (day >= triggerDay) {
          reason = `청구기준일(매월 ${rawBillingDay}일) 도래`;
        } else {
          reason = `전월 이월 미청구 계약`;
        }

        dueList.push({
          contract: c,
          customer: cust,
          site,
          billingDay: rawBillingDay,
          dueReason: reason
        });
      }
    });

    return dueList;
  };

  /**
   * billingDay 기반 청구 기간 계산 (인터뷰 원칙 A-1 ~ A-5, B-1 ~ B-4)
   * - billingDay = 청구서 발행일 (예: 25 → 전월26~당월25)
   * - 첫 달 / 마지막 달만 일할, 중간 달 정액
   * - billingDay > 월말이면 월말로 자동 보정
   */
  const calcBillingPeriod = (
    billingYm: string,
    billingDay: number,
    contractStartDate: string,
    contractEndDate?: string
  ) => {
    const [year, month] = billingYm.split('-').map(Number);

    // 당월 billingDay 보정 (A-5, UTC 기준)
    const lastDayOfCurrent = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const effectiveBillingDay = Math.min(billingDay, lastDayOfCurrent);

    // 청구 기간 끝: 당월 billingDay
    const periodEnd = new Date(Date.UTC(year, month - 1, effectiveBillingDay));

    // 청구 기간 시작: 전월 (billingDay+1)일
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const lastDayOfPrev = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
    const prevEffectiveBillingDay = Math.min(billingDay, lastDayOfPrev);
    const periodStart = new Date(Date.UTC(prevYear, prevMonth - 1, prevEffectiveBillingDay + 1));

    // 실제 자산 사용 기간: 계약 startDate 보정 (A-2)
    const contractStart = new Date(contractStartDate.includes('T') ? contractStartDate : `${contractStartDate}T00:00:00Z`);
    const actualStart = contractStart > periodStart ? contractStart : periodStart;

    // 실제 자산 사용 기간: 계약 endDate 보정 (A-3)
    const contractEnd = contractEndDate ? new Date(contractEndDate.includes('T') ? contractEndDate : `${contractEndDate}T00:00:00Z`) : null;
    const actualEnd = contractEnd && contractEnd < periodEnd ? contractEnd : periodEnd;

    // 첫 달 / 마지막 달 판단 → 일할 계산 여부 (B-2)
    const isFirstMonth = contractStart > periodStart && contractStart <= periodEnd;
    const isLastMonth = contractEnd
      ? contractEnd >= periodStart && contractEnd <= periodEnd
      : false;
    const isProRata = isFirstMonth || isLastMonth;

    return { actualStart, actualEnd, periodStart, periodEnd, isProRata };
  };

  /**
   * 일할 금액 계산 (B-1: 30일 고정, 역일 기준, 1,000원 단위 반올림 업계 전사 표준)
   */
  const calcProRataAmount = (monthlyFee: number, dailyFee: number, days: number): number => {
    if (dailyFee > 0) {
      return Math.round((dailyFee * days) / 1000) * 1000;
    }
    return Math.round(((monthlyFee / 30) * days) / 1000) * 1000;
  };

  /**
   * 💡 계약별 직전 청구 마일스톤 메타데이터 동기화 (트리거 갱신 및 백필)
   * - 최근 렌탈료 청구 발행일 (lastBillingDate)
   * - 최근 청구 시작일 (lastBilledPeriodStart)
   * - 최근 청구 종료일 (lastBilledPeriodEnd)
   * - 최근 청구 귀속월 (lastBilledYm)
   * - 누적 발행 청구 건수 (billingCount)
   */
  const syncContractBillingMilestones = (contractId?: string) => {
    const targetContracts = contractId 
      ? db.contracts.filter(c => c.id === contractId) 
      : db.contracts;

    targetContracts.forEach(c => {
      const activeBillings = db.billings
        .filter(b => b.contractId === c.id && b.status !== 'REJECTED')
        .sort((a, b) => (b.billingYm || '').localeCompare(a.billingYm || ''));

      const count = activeBillings.length;
      if (count === 0) {
        db.updateRow<Contract>('contracts', c.id, {
          lastBillingDate: undefined,
          lastBilledPeriodStart: undefined,
          lastBilledPeriodEnd: undefined,
          lastBilledYm: undefined,
          billingCount: 0,
          updatedAt: new Date().toISOString()
        } as any);
        return;
      }

      const latestBilling = activeBillings[0];
      const billingDay = c.billingDay || 25;
      const { actualStart, actualEnd } = calcBillingPeriod(
        latestBilling.billingYm,
        billingDay,
        c.startDate,
        c.endDate
      );

      const startIso = actualStart.toISOString().split('T')[0];
      const endIso = actualEnd.toISOString().split('T')[0];

      db.updateRow<Contract>('contracts', c.id, {
        lastBillingDate: latestBilling.billingDate || latestBilling.createdAt?.split('T')[0],
        lastBilledPeriodStart: startIso,
        lastBilledPeriodEnd: endIso,
        lastBilledYm: latestBilling.billingYm,
        billingCount: count,
        updatedAt: new Date().toISOString()
      });
    });
  };

  const generateBillingForSingleContract = async (contractId: string, billingYm: string, billingDate: string): Promise<string | null> => {
    const c = db.contracts.find(x => x.id === contractId);
    if (!c) return null;

    if ((c.contractType || 'RENTAL') !== 'RENTAL') {
      throw new Error(`[계약 유형 오류] 계약 ${c.contractNo}는 자산 매각 계약(SALE)입니다. 월 정기 렌탈료 청구 대상이 아닙니다.`);
    }

    // 중복 발행 감지 (J-3): 동일 계약 + 동일 귀속월 활성 청구 존재 시 throw
    const existingActive = db.billings.find(
      b => b.contractId === c.id && b.billingYm === billingYm && b.status !== 'REJECTED'
    );
    if (existingActive) {
      throw new Error(`[중복 경고] 계약 ${c.contractNo}의 ${billingYm} 청구서가 이미 존재합니다.\n상태: ${existingActive.status} / ID: ${existingActive.id}`);
    }

    const cust = db.customers.find(cu => cu.id === c.customerId);
    const billingDay = c.billingDay || cust?.defaultBillingDay || 25;
    const cAssets = db.contractAssets.filter(ca => ca.contractId === c.id);
    let detailsList: Omit<BillingDetail, 'id' | 'billingId' | 'createdAt'>[] = [];
    let totalAmount = 0;

    // 1. 자산별 렌탈료 계산 (인터뷰 원칙 A, B, C 통합 적용)
    cAssets.forEach(ca => {
      const { actualStart, actualEnd, isProRata } = calcBillingPeriod(
        billingYm,
        billingDay,
        ca.startDate,
        ca.endDate || c.endDate
      );

      if (actualStart > actualEnd) return; // 청구 기간 외 자산

      const assetInfo = db.assets.find(a => a.id === ca.assetId);
      const assetName = assetInfo
        ? `${assetInfo.modelName} (관리번호: ${assetInfo.assetNo})`
        : '렌탈 장비';

      let rentalCost = 0;
      let calcDesc = '';

      if (isProRata) {
        // 일할 계산: 30일 고정 (B-1), 역일 기준 (B-4)
        const diffMs = actualEnd.getTime() - actualStart.getTime();
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
        rentalCost = calcProRataAmount(ca.monthlyRentalFee, ca.dailyRentalFee, days);
        calcDesc = `${actualStart.toISOString().split('T')[0]} ~ ${actualEnd.toISOString().split('T')[0]} 일할 청구 (${days}일 × ${(ca.dailyRentalFee > 0 ? ca.dailyRentalFee : ca.monthlyRentalFee / 30).toLocaleString()}원)`;
      } else {
        // 중간 달: 월 정액 (B-2)
        rentalCost = ca.monthlyRentalFee;
        const startStr = actualStart.toISOString().split('T')[0];
        const endStr = actualEnd.toISOString().split('T')[0];
        calcDesc = `${startStr} ~ ${endStr} 정기 월렌탈료`;
      }

      if (rentalCost > 0) {
        detailsList.push({
          contractAssetId: ca.id,
          assetId: ca.assetId,
          itemName: `${assetName} 렌탈료`,
          quantity: 1,
          unitPrice: rentalCost,
          amount: rentalCost,
          internalDescription: calcDesc,
          displayName: undefined
        });
        totalAmount += rentalCost;

        if (assetInfo) {
          // 기수 원칙: 청구서 발행(기수) 시점에만 cumRentalFee 누적 — 미수(미발행) 금액 절대 포함 금지
          db.updateRow<Asset>('assets', assetInfo.id, {
            cumRentalFee: (assetInfo.cumRentalFee || 0) + rentalCost,
            updatedAt: new Date().toISOString()
          });
        }
      }
    });

    // 2. 수리비 자동 합산 제거 (H-1 원칙: 수리비는 외상미수금 대장으로 분리 관리)
    // → 담당자가 외상미수금 화면에서 수동으로 청구에 포함

    // 3. 선수금(예치금) 차감 반영 (I-1 원칙: 청구 발생 시 자동 차감)
    let finalBillingAmount = totalAmount;
    if (cust && (cust.prepaidBalance || 0) > 0 && totalAmount > 0) {
      const prepaid = cust.prepaidBalance || 0;
      const applied = Math.min(totalAmount, prepaid);
      if (applied > 0) {
        detailsList.push({
          contractAssetId: undefined,
          itemName: '선수금(예치금) 차감 반영',
          quantity: 1,
          unitPrice: -applied,
          amount: -applied,
          internalDescription: `보유 선수금 중 ${applied.toLocaleString()}원 자동 차감`,
          displayName: undefined
        });
        db.updateRow<Customer>('customers', cust.id, {
          prepaidBalance: prepaid - applied,
          updatedAt: new Date().toISOString()
        } as any);
        finalBillingAmount = totalAmount - applied;
      }
    }

    if (detailsList.length === 0) return null;

    // 4. 청구서 생성 — 초기 상태 UNPAID (F-2 원칙: 거래명세서 발송 후 REQUESTED로 전환)
    const newBilling = db.insertRow<Billing>('billings', {
      customerId: c.customerId,
      contractId: c.id,
      billingYm,
      billingDate,
      totalAmount: finalBillingAmount,
      paidAmount: 0,
      status: 'UNPAID',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    detailsList.forEach(det => {
      db.insertRow<BillingDetail>('billingDetails', {
        ...det,
        billingId: newBilling.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    });

    // 💡 계약 메타데이터 트리거 자동 갱신 (최근 청구 발행일, 시작일, 종료일, 청구건수)
    syncContractBillingMilestones(c.id);

    return newBilling.id;
  };

  const generateDueBillings = async (targetDate?: string, targetYm?: string): Promise<{ successCount: number; skippedContracts: { contractId: string; customerId: string; reason: string }[] }> => {
    try {
      const todayStr = targetDate || new Date().toISOString().split('T')[0];
      const ym = targetYm || todayStr.slice(0, 7);
      const dueContracts = getDueContractsForBilling(todayStr);

      let createdCount = 0;
      const skippedContracts: { contractId: string; customerId: string; reason: string }[] = [];

      for (const item of dueContracts) {
        // K-1: 미청구 외상미수금 존재 여부 체크 (일괄 청구 방어 로직)
        const hasPendingReceivables = db.receivables.some(r => 
          r.contractId === item.contract.id && r.status !== 'CLEARED'
        );

        if (hasPendingReceivables) {
          skippedContracts.push({
            contractId: item.contract.id,
            customerId: item.customer.id,
            reason: '미청구 외상미수금 존재'
          });
          continue; // 해당 계약은 청구 건너뜀 (SKIP)
        }

        const bId = await generateBillingForSingleContract(item.contract.id, ym, todayStr);
        if (bId) createdCount++;
      }

      await db.awaitPendingWrites();
      refreshAllData();
      return { successCount: createdCount, skippedContracts };
    } catch (err: any) {
      showErrorModal(`⚠️ 도래 계약 청구 일괄 생성 실패:\n\n${err?.message || err}`, '청구 생성 오류');
      return { successCount: 0, skippedContracts: [] };
    }
  };

  const regenerateBilling = async (
    billingId: string,
    customDetails?: Omit<BillingDetail, 'id' | 'billingId' | 'createdAt'>[],
    options?: { billingYm?: string; billingDate?: string; memo?: string }
  ): Promise<string> => {
    const oldBilling = db.billings.find(b => b.id === billingId);
    if (!oldBilling) throw new Error('청구서를 찾을 수 없습니다.');

    // 1. 기존 청구서 롤백 & 상태 REJECTED 마감
    const oldDetails = db.billingDetails.filter(bd => bd.billingId === billingId);
    oldDetails.forEach(bd => {
      if (bd.itemName === '선수금(예치금) 차감 반영') {
        const cust = db.customers.find(c => c.id === oldBilling.customerId);
        if (cust) {
          db.updateRow<Customer>('customers', cust.id, {
            prepaidBalance: (cust.prepaidBalance || 0) + Math.abs(bd.amount),
            updatedAt: new Date().toISOString()
          } as any);
        }
      }
      if (bd.contractAssetId) {
        const ca = db.contractAssets.find(x => x.id === bd.contractAssetId);
        if (ca) {
          const ast = db.assets.find(a => a.id === ca.assetId);
          if (ast) {
            db.updateRow<Asset>('assets', ast.id, {
              cumRentalFee: Math.max(0, (ast.cumRentalFee || 0) - bd.amount),
              updatedAt: new Date().toISOString()
            });
          }
        }
      }
      // 💡 [Gap 4 방어] 외상미수금 청구액 롤백
      if (bd.receivableId) {
        const rcv = db.receivables.find(r => r.id === bd.receivableId);
        if (rcv) {
          const newBilled = Math.max(0, rcv.billedAmount - (bd.amount || 0));
          db.updateRow<Receivable>('receivables', rcv.id, {
            billedAmount: newBilled,
            status: newBilled === 0 ? 'PENDING' : (newBilled >= rcv.totalAmount ? 'CLEARED' : 'PARTIAL'),
            updatedAt: new Date().toISOString()
          });
        }
      }
    });

    // 기존 연결 수리비 해제
    const linkedRepairs = db.repairs.filter(r => r.billingId === billingId);
    linkedRepairs.forEach(r => {
      db.updateRow<Repair>('repairs', r.id, { billingId: undefined });
    });

    // 기존 청구서 REJECTED 처리 (감사 추적성 보존)
    db.updateRow<Billing>('billings', billingId, {
      status: 'REJECTED',
      rejectReason: options?.memo || '수정사항 반영에 따른 기존 청구서 취소 및 재생성',
      updatedAt: new Date().toISOString()
    });

    // 2. 새 청구서 생성
    const newYm = options?.billingYm || oldBilling.billingYm;
    const newDate = options?.billingDate || oldBilling.billingDate || new Date().toISOString().split('T')[0];

    const finalDetails = customDetails && customDetails.length > 0 ? customDetails : oldDetails.map(od => ({
      contractAssetId: od.contractAssetId,
      itemName: od.itemName,
      quantity: od.quantity,
      unitPrice: od.unitPrice,
      amount: od.amount,
      description: od.description
    }));

    const newTotalAmount = finalDetails.reduce((sum, d) => sum + (d.amount || (d.quantity * d.unitPrice)), 0);

    const newBilling = db.insertRow<Billing>('billings', {
      customerId: oldBilling.customerId,
      contractId: oldBilling.contractId,
      billingYm: newYm,
      billingDate: newDate,
      totalAmount: newTotalAmount,
      paidAmount: 0,
      status: 'REQUESTED',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    finalDetails.forEach(det => {
      db.insertRow<BillingDetail>('billingDetails', {
        ...det,
        billingId: newBilling.id,
        createdAt: new Date().toISOString()
      });

      if (det.contractAssetId) {
        const ca = db.contractAssets.find(x => x.id === det.contractAssetId);
        if (ca) {
          const ast = db.assets.find(a => a.id === ca.assetId);
          if (ast) {
            db.updateRow<Asset>('assets', ast.id, {
              cumRentalFee: (ast.cumRentalFee || 0) + det.amount,
              updatedAt: new Date().toISOString()
            });
          }
        }
      }
    });

    // 계약이력 기록 (재생성)
    if (oldBilling.contractId) {
      db.insertRow<ContractHistory>('contractHistory', {
        contractId: oldBilling.contractId,
        changeType: 'BILLING_REGENERATED',
        changeDate: new Date().toISOString().split('T')[0],
        description: `청구 재생성: ${newYm} / ${newTotalAmount.toLocaleString()}원 (기존 ${billingId} → 신규 ${newBilling.id}, 사유: ${options?.memo || '수정사항 반영'})`,
        createdAt: new Date().toISOString()
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
    return newBilling.id;
  };

  // v2: 복수 입금건 연동 수납 처리
  const receivePayment = async (billingId: string, data: {
    paymentDate: string;
    amount: number;
    method: string;
    memo: string;
    depositLinks?: { bankTransactionId: string; usedAmount: number }[];
  }) => {
    const billing = db.billings.find(b => b.id === billingId);
    if (!billing) {
      showErrorModal('청구서를 찾을 수 없습니다.');
      return;
    }
    if (!data.amount || data.amount <= 0) {
      showErrorModal('수납 금액은 1원 이상이어야 합니다.');
      return;
    }

    // Payment 1건 생성
    const newPayment = db.insertRow<Payment>('payments', {
      billingId,
      paymentDate: data.paymentDate,
      amount: data.amount,
      method: data.method,
      memo: data.memo,
      createdAt: new Date().toISOString()
    });

    // PaymentDepositLinks N건 생성 (통장입금 연동 시)
    if (data.depositLinks && data.depositLinks.length > 0) {
      for (const link of data.depositLinks) {
        if (link.usedAmount > 0) {
          db.insertRow<PaymentDepositLink>('paymentDepositLinks', {
            paymentId: newPayment.id,
            bankTransactionId: link.bankTransactionId,
            usedAmount: link.usedAmount,
            createdAt: new Date().toISOString()
          });
        }
      }
    }

    // Billing.paidAmount / status 자동 갱신 (VAT 포함 총액 기준)
    const nextPaid = billing.paidAmount + data.amount;
    const supply = billing.totalAmount || 0;
    const grandTotal = supply + Math.round(supply * 0.1);
    let nextStatus: Billing['status'] = 'UNPAID';
    if (nextPaid >= grandTotal) {
      nextStatus = 'PAID';
    } else if (nextPaid > 0) {
      nextStatus = 'PARTIAL';
    }

    db.updateRow<Billing>('billings', billingId, {
      paidAmount: nextPaid,
      status: nextStatus,
      updatedAt: new Date().toISOString()
    });

    // 계약이력 기록
    if (billing.contractId) {
      db.insertRow<ContractHistory>('contractHistory', {
        contractId: billing.contractId,
        changeType: 'PAYMENT_RECEIVED',
        changeDate: data.paymentDate,
        description: `수납 처리: ${billing.billingYm} / ${data.amount.toLocaleString()}원 수납 (누적: ${nextPaid.toLocaleString()}/${grandTotal.toLocaleString()}원, 상태: ${nextStatus})`,
        createdAt: new Date().toISOString()
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 수납 취소: Payment 삭제 + 연결된 PDL 전체 삭제 + Billing.paidAmount 롤백 + 선수금 환원 + 계약 이력 보존
  const cancelPayment = async (paymentId: string) => {
    const payment = db.payments.find(p => p.id === paymentId);
    if (!payment) return;

    // 1. 연결된 PDL 모두 삭제 (통장 입금잔액 자동 복원)
    const linkedLinks = db.paymentDepositLinks.filter(l => l.paymentId === paymentId);
    for (const link of linkedLinks) {
      db.deleteRow('paymentDepositLinks', link.id);
    }

    // 2. 선수금 상계 수납 건인 경우 고객 선수금 잔액 자동 환원
    const billing = db.billings.find(b => b.id === payment.billingId);
    if (payment.method === 'PREPAID' && billing) {
      const cust = db.customers.find(c => c.id === billing.customerId);
      if (cust) {
        db.updateRow<Customer>('customers', cust.id, {
          prepaidBalance: (cust.prepaidBalance || 0) + payment.amount,
          updatedAt: new Date().toISOString()
        });
      }
    }

    // 3. Payment 삭제
    db.deleteRow('payments', paymentId);

    // 4. Billing paidAmount 및 상태 롤백
    if (billing) {
      const newPaid = Math.max(0, (billing.paidAmount || 0) - payment.amount);
      const bSupply = billing.totalAmount || 0;
      const bGrand = bSupply + Math.round(bSupply * 0.1);
      let newStatus: Billing['status'] = 'UNPAID';
      if (newPaid >= bGrand) newStatus = 'PAID';
      else if (newPaid > 0) newStatus = 'PARTIAL';

      db.updateRow<Billing>('billings', billing.id, {
        paidAmount: newPaid,
        status: newStatus,
        updatedAt: new Date().toISOString()
      });

      // 5. 계약 이력(ContractHistory) 무누락 기록
      if (billing.contractId) {
        db.insertRow<ContractHistory>('contractHistory', {
          contractId: billing.contractId,
          changeType: 'PAYMENT_CANCELLED',
          changeDate: new Date().toISOString().split('T')[0],
          description: `수납 취소 (롤백): ${billing.billingYm} 청구분 / ${payment.amount.toLocaleString()}원 수납 취소 (${payment.method}) (수납후 잔액: ${newPaid.toLocaleString()}원, 상태: ${newStatus})`,
          createdAt: new Date().toISOString()
        });
      }
    }

    refreshAllData();
    await db.awaitPendingWrites();
  };

  // 특정 청구서의 모든 수납 내역 일괄 취소 및 완전 롤백
  const cancelAllPaymentsForBilling = async (billingId: string) => {
    const targetPayments = db.payments.filter(p => p.billingId === billingId);
    for (const p of targetPayments) {
      await cancelPayment(p.id);
    }
  };

  // 통장입금 등록 (입금내역으로 수납 재원 등록)
  const saveBankDeposit = (data: Omit<BankTransaction, 'id' | 'createdAt' | 'withdrawAmount'>) => {
    db.insertRow<BankTransaction>('bankTransactions', {
      ...data,
      withdrawAmount: 0,
      isDeposit: true,
      createdAt: new Date().toISOString()
    });
    refreshAllData();
  };

  // 통장입금 삭제 (연결된 PaymentDepositLink가 있으면 차단)
  const deleteBankDeposit = (txId: string) => {
    const linked = db.paymentDepositLinks.filter(l => l.bankTransactionId === txId);
    if (linked.length > 0) {
      throw new Error(`이 입금건에 연결된 수납 내역 ${linked.length}건이 존재합니다.\n수납을 먼저 취소한 후 삭제하세요.`);
    }
    // ✅ 고아 레코드 방지: 레거시 패턴 수납 레코드 존재 시 삭제 차단
    const legacyPayments = db.payments.filter(p => p.id.startsWith(`pay-matching-${txId}`));
    if (legacyPayments.length > 0) {
      throw new Error(`이 입금건에 연결된 레거시 수납 기록 ${legacyPayments.length}건이 존재합니다.\n수납을 먼저 취소한 후 삭제하세요.`);
    }
    db.deleteRow('bankTransactions', txId);
    refreshAllData();
  };


  const executeMatch = (
    txId: string,
    billingId: string,
    matchingType: 'AUTO' | 'MANUAL',
    options?: {
      matchingMode?: 'PINPOINT' | 'CASCADE' | 'MULTI';
      allocations?: { billingId: string; amount: number; feeAdjustment?: number }[];
      feeAdjustment?: number;
    }
  ) => {
    const tx = db.bankTransactions.find(t => t.id === txId);
    const firstBilling = db.billings.find(b => b.id === billingId);
    if (!tx || !firstBilling) return;

    const customerId = firstBilling.customerId;
    const mode = options?.matchingMode || 'CASCADE';
    let remainingDeposit = tx.depositAmount;
    const matchedBillingIds: string[] = [];

    if (mode === 'MULTI' && options?.allocations && options.allocations.length > 0) {
      // 🌟 [MULTI 모드]: 사용자가 지정한 청구서별 금액 및 감액 직접 적용
      for (const alloc of options.allocations) {
        if (remainingDeposit <= 0 && (!alloc.amount || alloc.amount <= 0)) continue;
        const billing = db.billings.find(b => b.id === alloc.billingId);
        if (!billing) continue;

        const bSup = billing.totalAmount || 0;
        const bGrand = bSup + Math.round(bSup * 0.1);
        const feeAdj = alloc.feeAdjustment || 0;
        const paymentAmount = Math.min(alloc.amount, remainingDeposit);
        remainingDeposit = Math.max(0, remainingDeposit - paymentAmount);

        const payId = `pay-matching-${txId}-${billing.id}`;
        db.insertRow<Payment>('payments', {
          id: payId,
          billingId: billing.id,
          paymentDate: tx.transactionDate.split(' ')[0],
          amount: paymentAmount,
          method: 'BANK_TRANSFER',
          memo: `사용자 분할 대조 수납 (${tx.senderName})${feeAdj > 0 ? ` (수수료 감액 ₩${feeAdj.toLocaleString()})` : ''}`,
          feeAdjustment: feeAdj > 0 ? feeAdj : undefined,
          createdAt: new Date().toISOString()
        });

        db.insertRow<PaymentDepositLink>('paymentDepositLinks', {
          paymentId: payId,
          bankTransactionId: txId,
          usedAmount: paymentAmount,
          createdAt: new Date().toISOString()
        });

        const nextPaid = (billing.paidAmount || 0) + paymentAmount + feeAdj;
        const nextStatus: Billing['status'] = nextPaid >= bGrand ? 'PAID' : 'PARTIAL';
        db.updateRow<Billing>('billings', billing.id, {
          paidAmount: nextPaid,
          status: nextStatus,
          updatedAt: new Date().toISOString()
        });

        if (billing.contractId) {
          db.insertRow<ContractHistory>('contractHistory', {
            contractId: billing.contractId,
            changeType: 'PAYMENT_RECEIVED',
            changeDate: tx.transactionDate.split(' ')[0],
            description: `수납 처리 (통장대조): ${billing.billingYm} / ${paymentAmount.toLocaleString()}원 수납 (누적: ${nextPaid.toLocaleString()}/${bGrand.toLocaleString()}원, 상태: ${nextStatus})${feeAdj > 0 ? ` (수수료 감액 ₩${feeAdj.toLocaleString()})` : ''}`,
            createdAt: new Date().toISOString()
          });
        }
        matchedBillingIds.push(billing.id);
      }
    } else if (mode === 'PINPOINT') {
      // 🌟 [PINPOINT 모드]: 선택한 단일 청구서에만 전액 충당
      const billing = firstBilling;
      const bSup = billing.totalAmount || 0;
      const bGrand = bSup + Math.round(bSup * 0.1);
      const feeAdj = options?.feeAdjustment || 0;
      const unpaidAmount = Math.max(0, bGrand - (billing.paidAmount || 0) - feeAdj);

      const paymentAmount = Math.min(unpaidAmount, remainingDeposit);
      remainingDeposit -= paymentAmount;

      const payId = `pay-matching-${txId}-${billing.id}`;
      db.insertRow<Payment>('payments', {
        id: payId,
        billingId: billing.id,
        paymentDate: tx.transactionDate.split(' ')[0],
        amount: paymentAmount,
        method: 'BANK_TRANSFER',
        memo: `단독 지정 대조 수납 (${tx.senderName})${feeAdj > 0 ? ` (수수료 감액 ₩${feeAdj.toLocaleString()})` : ''}`,
        feeAdjustment: feeAdj > 0 ? feeAdj : undefined,
        createdAt: new Date().toISOString()
      });

      db.insertRow<PaymentDepositLink>('paymentDepositLinks', {
        paymentId: payId,
        bankTransactionId: txId,
        usedAmount: paymentAmount,
        createdAt: new Date().toISOString()
      });

      const nextPaid = (billing.paidAmount || 0) + paymentAmount + feeAdj;
      const nextStatus: Billing['status'] = nextPaid >= bGrand ? 'PAID' : 'PARTIAL';
      db.updateRow<Billing>('billings', billing.id, {
        paidAmount: nextPaid,
        status: nextStatus,
        updatedAt: new Date().toISOString()
      });

      if (billing.contractId) {
        db.insertRow<ContractHistory>('contractHistory', {
          contractId: billing.contractId,
          changeType: 'PAYMENT_RECEIVED',
          changeDate: tx.transactionDate.split(' ')[0],
          description: `수납 처리 (통장대조 단독): ${billing.billingYm} / ${paymentAmount.toLocaleString()}원 수납 (누적: ${nextPaid.toLocaleString()}/${bGrand.toLocaleString()}원, 상태: ${nextStatus})${feeAdj > 0 ? ` (수수료 감액 ₩${feeAdj.toLocaleString()})` : ''}`,
          createdAt: new Date().toISOString()
        });
      }
      matchedBillingIds.push(billing.id);
    } else {
      // 🌟 [CASCADE 모드]: 과거 미수부터 순차 충당 (수수료 감액 옵션 포함)
      const activeBillings = db.billings
        .filter(b => b.customerId === customerId && (b.status === 'UNPAID' || b.status === 'PARTIAL'))
        .sort((a, b) => a.billingYm.localeCompare(b.billingYm));

      if (!activeBillings.some(x => x.id === billingId)) {
        activeBillings.unshift(firstBilling);
      }

      let feeAdjRemaining = options?.feeAdjustment || 0;

      for (const billing of activeBillings) {
        if (remainingDeposit <= 0 && feeAdjRemaining <= 0) break;

        const bSup = billing.totalAmount || 0;
        const bGrand = bSup + Math.round(bSup * 0.1);
        let unpaidAmount = Math.max(0, bGrand - (billing.paidAmount || 0));
        if (unpaidAmount <= 0) continue;

        let feeAdjForThis = 0;
        if (feeAdjRemaining > 0) {
          feeAdjForThis = Math.min(feeAdjRemaining, unpaidAmount);
          feeAdjRemaining -= feeAdjForThis;
          unpaidAmount -= feeAdjForThis;
        }

        const paymentAmount = Math.min(unpaidAmount, remainingDeposit);
        remainingDeposit -= paymentAmount;

        const payId = `pay-matching-${txId}-${billing.id}`;
        db.insertRow<Payment>('payments', {
          id: payId,
          billingId: billing.id,
          paymentDate: tx.transactionDate.split(' ')[0],
          amount: paymentAmount,
          method: 'BANK_TRANSFER',
          memo: `${matchingType === 'AUTO' ? '자동' : '수동'} 순차 대조 수납 (${tx.senderName})${feeAdjForThis > 0 ? ` (수수료 감액 ₩${feeAdjForThis.toLocaleString()})` : ''}`,
          feeAdjustment: feeAdjForThis > 0 ? feeAdjForThis : undefined,
          createdAt: new Date().toISOString()
        });

        db.insertRow<PaymentDepositLink>('paymentDepositLinks', {
          paymentId: payId,
          bankTransactionId: txId,
          usedAmount: paymentAmount,
          createdAt: new Date().toISOString()
        });

        const nextPaid = (billing.paidAmount || 0) + paymentAmount + feeAdjForThis;
        const nextStatus: Billing['status'] = nextPaid >= bGrand ? 'PAID' : 'PARTIAL';
        db.updateRow<Billing>('billings', billing.id, {
          paidAmount: nextPaid,
          status: nextStatus,
          updatedAt: new Date().toISOString()
        });

        if (billing.contractId) {
          db.insertRow<ContractHistory>('contractHistory', {
            contractId: billing.contractId,
            changeType: 'PAYMENT_RECEIVED',
            changeDate: tx.transactionDate.split(' ')[0],
            description: `수납 처리 (${matchingType === 'AUTO' ? '통장대조 자동' : '통장대조 순차'}): ${billing.billingYm} / ${paymentAmount.toLocaleString()}원 수납 (누적: ${nextPaid.toLocaleString()}/${bGrand.toLocaleString()}원, 상태: ${nextStatus})${feeAdjForThis > 0 ? ` (수수료 감액 ₩${feeAdjForThis.toLocaleString()})` : ''}`,
            createdAt: new Date().toISOString()
          });
        }

        matchedBillingIds.push(billing.id);
      }
    }

    // 2. 남은 초과금 선수금 적립 (과대입금 완벽 수지 보존)
    if (remainingDeposit > 0) {
      const customer = db.customers.find(c => c.id === customerId);
      if (customer) {
        const prevPrepaid = customer.prepaidBalance || 0;
        db.updateRow<Customer>('customers', customerId, {
          prepaidBalance: prevPrepaid + remainingDeposit,
          updatedAt: new Date().toISOString()
        } as any);

        const prepaidPayId = `pay-matching-${txId}-prepaid`;
        // 선수금 가상 수납 전표 등록
        db.insertRow<Payment>('payments', {
          id: prepaidPayId,
          billingId: '',
          paymentDate: tx.transactionDate.split(' ')[0],
          amount: remainingDeposit,
          method: 'BANK_TRANSFER',
          memo: `통장 대조 매칭 초과 선수금 적립 (${tx.senderName})`,
          createdAt: new Date().toISOString()
        });

        // 🌟 선수금 전표에 대해서도 PaymentDepositLink를 등록하여 통장 입금 사용 추적 완벽 일치화!
        db.insertRow<PaymentDepositLink>('paymentDepositLinks', {
          paymentId: prepaidPayId,
          bankTransactionId: txId,
          usedAmount: remainingDeposit,
          createdAt: new Date().toISOString()
        });
      }
    }

    // 3. 거래 내역 상태 변경
    db.updateRow<BankTransaction>('bankTransactions', txId, {
      matchedBillingId: matchedBillingIds.length > 0 ? matchedBillingIds[0] : billingId,
      matchingType,
      updatedAt: new Date().toISOString()
    } as any);
  };

  const tryAutoMatchForTransaction = (tx: BankTransaction) => {
    const getBillingGrand = (b: Billing) => {
      const sup = b.totalAmount || 0;
      return sup + Math.round(sup * 0.1);
    };

    const cleanName = (n: string) => (n || '').replace(/\(주\)|주식회사|\s+/g, '').toLowerCase();
    const cleanSender = cleanName(tx.senderName);

    const rule = db.bankMatchingRules.find(r => r.senderName === tx.senderName);
    if (rule) {
      const activeBillings = db.billings.filter(b => 
        b.customerId === rule.customerId && 
        (b.status === 'UNPAID' || b.status === 'PARTIAL')
      );
      if (activeBillings.length > 0) {
        let target = activeBillings.find(b => (getBillingGrand(b) - (b.paidAmount || 0)) === tx.depositAmount);
        if (!target) {
          target = activeBillings.sort((a, b) => a.billingYm.localeCompare(b.billingYm))[0];
        }
        executeMatch(tx.id, target.id, 'AUTO', { matchingMode: 'CASCADE' });
        return;
      }
    }

    const matchedCustomer = db.customers.find(c => {
      const cClean = cleanName(c.name);
      return cleanSender && cClean && (cleanSender.includes(cClean) || cClean.includes(cleanSender));
    });
    if (matchedCustomer) {
      const activeBillings = db.billings.filter(b => 
        b.customerId === matchedCustomer.id && 
        (b.status === 'UNPAID' || b.status === 'PARTIAL')
      );
      if (activeBillings.length > 0) {
        let target = activeBillings.find(b => (getBillingGrand(b) - (b.paidAmount || 0)) === tx.depositAmount);
        if (!target) {
          target = activeBillings.sort((a, b) => a.billingYm.localeCompare(b.billingYm))[0];
        }
        executeMatch(tx.id, target.id, 'AUTO', { matchingMode: 'CASCADE' });
        return;
      }
    }
  };

  const uploadBankTransactions = (txs: Omit<BankTransaction, 'id' | 'createdAt'>[]) => {
    txs.forEach(tx => {
      const newTx = db.insertRow<BankTransaction>('bankTransactions', {
        ...tx,
        matchedBillingId: undefined,
        matchingType: undefined,
        createdAt: new Date().toISOString()
      } as any);

      if (newTx.depositAmount > 0) {
        tryAutoMatchForTransaction(newTx);
      }
    });
    refreshAllData();
  };

  const batchAutoMatchTransactions = async () => {
    const unallocatedTxs = db.bankTransactions.filter(t => 
      (t.depositAmount || 0) > 0 && !t.matchedBillingId
    );
    let matchedCount = 0;
    for (const tx of unallocatedTxs) {
      const prevMatched = tx.matchedBillingId;
      tryAutoMatchForTransaction(tx);
      const updatedTx = db.bankTransactions.find(t => t.id === tx.id);
      if (updatedTx?.matchedBillingId && updatedTx.matchedBillingId !== prevMatched) {
        matchedCount++;
      }
    }
    await db.awaitPendingWrites();
    refreshAllData();
    return matchedCount;
  };

  const matchTransactionManual = async (
    txId: string,
    billingId: string,
    learnRule: boolean,
    options?: {
      matchingMode?: 'PINPOINT' | 'CASCADE' | 'MULTI';
      allocations?: { billingId: string; amount: number; feeAdjustment?: number }[];
      feeAdjustment?: number;
    }
  ) => {
    const tx = db.bankTransactions.find(t => t.id === txId);
    const billing = db.billings.find(b => b.id === billingId);
    if (!tx || !billing) return;

    executeMatch(txId, billingId, 'MANUAL', options);

    if (learnRule) {
      const exists = db.bankMatchingRules.some(r => r.senderName === tx.senderName);
      if (!exists) {
        db.insertRow<BankMatchingRule>('bankMatchingRules', {
          senderName: tx.senderName,
          customerId: billing.customerId,
          createdAt: new Date().toISOString()
        });
      }
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const unmatchTransaction = async (txId: string) => {
    const tx = db.bankTransactions.find(t => t.id === txId);
    if (!tx) return;

    // customerId 식별 (청구서, 매칭규칙, 거래처 역추적)
    const linkedLinks = db.paymentDepositLinks.filter(l => l.bankTransactionId === txId);
    let customerId: string | undefined;
    for (const link of linkedLinks) {
      const p = db.payments.find(x => x.id === link.paymentId);
      if (p?.billingId) {
        const b = db.billings.find(x => x.id === p.billingId);
        if (b?.customerId) {
          customerId = b.customerId;
          break;
        }
      }
    }
    if (!customerId && tx.matchedBillingId) {
      const b = db.billings.find(x => x.id === tx.matchedBillingId);
      if (b?.customerId) customerId = b.customerId;
    }
    if (!customerId) {
      customerId = db.bankMatchingRules.find(r => r.senderName === tx.senderName)?.customerId;
    }
    if (!customerId) {
      const cleanSender = (tx.senderName || '').replace(/\(주\)|주식회사|\s+/g, '').toLowerCase();
      customerId = db.customers.find(c => {
        const cClean = (c.name || '').replace(/\(주\)|주식회사|\s+/g, '').toLowerCase();
        return cleanSender && cClean && (cleanSender.includes(cClean) || cClean.includes(cleanSender));
      })?.id;
    }

    // 1. paymentDepositLinks 기반 롤백 (신규 체계)
    linkedLinks.forEach(link => {
      const pay = db.payments.find(p => p.id === link.paymentId);
      if (pay) {
        if (pay.billingId) {
          const billing = db.billings.find(b => b.id === pay.billingId);
          if (billing) {
            const bSup = billing.totalAmount || 0;
            const bGrand = bSup + Math.round(bSup * 0.1);
            const feeAdj = pay.feeAdjustment || 0;
            const nextPaid = Math.max(0, (billing.paidAmount || 0) - link.usedAmount - feeAdj);
            const nextStatus: Billing['status'] = nextPaid === 0 ? 'UNPAID' : (nextPaid >= bGrand ? 'PAID' : 'PARTIAL');
            db.updateRow<Billing>('billings', billing.id, {
              paidAmount: nextPaid,
              status: nextStatus,
              updatedAt: new Date().toISOString()
            });

            if (billing.contractId) {
              db.insertRow<ContractHistory>('contractHistory', {
                contractId: billing.contractId,
                changeType: 'PAYMENT_CANCELLED',
                changeDate: new Date().toISOString().split('T')[0],
                description: `수납 대조 해제: ${billing.billingYm} 청구분 / ${link.usedAmount.toLocaleString()}원 수납 취소 (잔여: ${nextPaid.toLocaleString()}원, 상태: ${nextStatus})`,
                createdAt: new Date().toISOString()
              });
            }
          }
        } else if (pay.id.endsWith('-prepaid') || !pay.billingId) {
          // 초과 선수금 환원 차감
          if (customerId) {
            const customer = db.customers.find(c => c.id === customerId);
            if (customer) {
              db.updateRow<Customer>('customers', customerId, {
                prepaidBalance: Math.max(0, (customer.prepaidBalance || 0) - pay.amount),
                updatedAt: new Date().toISOString()
              } as any);
            }
          }
        }

        if (pay.id.startsWith(`pay-matching-${txId}`)) {
          db.deleteRow('payments', pay.id);
        } else {
          const newAmount = Math.max(0, pay.amount - link.usedAmount);
          if (newAmount === 0) {
            db.deleteRow('payments', pay.id);
          } else {
            db.updateRow<Payment>('payments', pay.id, { amount: newAmount, updatedAt: new Date().toISOString() });
          }
        }
      }
      db.deleteRow('paymentDepositLinks', link.id);
    });

    // 2. 레거시 ID 패턴(`pay-matching-${txId}`)으로 잔존하는 수납 전표 검색 및 롤백
    const matchPrefix = `pay-matching-${txId}`;
    const associatedPayments = db.payments.filter(p => p.id.startsWith(matchPrefix));

    associatedPayments.forEach(pay => {
      if (pay.billingId) {
        const billing = db.billings.find(b => b.id === pay.billingId);
        if (billing) {
          const bSup = billing.totalAmount || 0;
          const bGrand = bSup + Math.round(bSup * 0.1);
          const feeAdj = pay.feeAdjustment || 0;
          const nextPaid = Math.max(0, (billing.paidAmount || 0) - pay.amount - feeAdj);
          const nextStatus: Billing['status'] = nextPaid === 0 ? 'UNPAID' : (nextPaid >= bGrand ? 'PAID' : 'PARTIAL');
          db.updateRow<Billing>('billings', billing.id, {
            paidAmount: nextPaid,
            status: nextStatus,
            updatedAt: new Date().toISOString()
          });

          if (billing.contractId) {
            db.insertRow<ContractHistory>('contractHistory', {
              contractId: billing.contractId,
              changeType: 'PAYMENT_CANCELLED',
              changeDate: new Date().toISOString().split('T')[0],
              description: `수납 대조 해제(레거시): ${billing.billingYm} 청구분 / ${pay.amount.toLocaleString()}원 수납 취소 (잔여: ${nextPaid.toLocaleString()}원, 상태: ${nextStatus})`,
              createdAt: new Date().toISOString()
            });
          }
        }
      } else if (customerId) {
        const customer = db.customers.find(c => c.id === customerId);
        if (customer) {
          db.updateRow<Customer>('customers', customerId, {
            prepaidBalance: Math.max(0, (customer.prepaidBalance || 0) - pay.amount),
            updatedAt: new Date().toISOString()
          } as any);
        }
      }
      db.deleteRow('payments', pay.id);
    });

    // 3. 거래 정보 복구
    db.updateRow<BankTransaction>('bankTransactions', txId, {
      matchedBillingId: '',
      matchingType: undefined,
      updatedAt: new Date().toISOString()
    } as any);

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const saveMatchingRule = (senderName: string, customerId: string) => {
    const existing = db.bankMatchingRules.find(r => r.senderName.toLowerCase() === senderName.toLowerCase());
    if (existing) {
      db.updateRow<BankMatchingRule>('bankMatchingRules', existing.id, {
        customerId,
        updatedAt: new Date().toISOString()
      } as any);
    } else {
      db.insertRow<BankMatchingRule>('bankMatchingRules', {
        senderName,
        customerId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as any);
    }
    refreshAllData();
  };

  const deleteMatchingRule = (ruleId: string) => {
    db.deleteRow('bankMatchingRules', ruleId);
    refreshAllData();
  };

  const saveBankInitialBalance = async (bankName: string, initialBalance: number, accountNumber?: string) => {
    const existing = db.bankInitialBalances.find(b => b.bankName === bankName);
    if (existing) {
      db.updateRow<BankAccountInitialBalance>('bankInitialBalances', existing.id, {
        initialBalance,
        accountNumber: accountNumber || existing.accountNumber,
        updatedAt: new Date().toISOString()
      } as any);
    } else {
      db.insertRow<BankAccountInitialBalance>('bankInitialBalances', {
        id: `bank-init-${bankName}`,
        bankName,
        accountNumber,
        initialBalance,
        updatedAt: new Date().toISOString()
      } as any);
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const updateAnnualLeaveQuota = async (userId: string, periodStart: string, periodEnd: string, grantedDays: number, memo?: string) => {
    const existing = db.annualLeaveQuotas.find(q => q.userId === userId && q.periodStart === periodStart);
    if (existing) {
      db.updateRow<AnnualLeaveQuota>('annualLeaveQuotas', existing.id, {
        grantedDays,
        memo,
        updatedAt: new Date().toISOString()
      } as any);
    } else {
      db.insertRow<AnnualLeaveQuota>('annualLeaveQuotas', {
        userId,
        periodStart,
        periodEnd,
        grantedDays,
        memo,
        createdAt: new Date().toISOString()
      } as any);
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const addLeaveUsage = async (usage: Omit<LeaveUsage, 'id' | 'createdAt'>) => {
    const newLeave = db.insertRow<LeaveUsage>('leaveUsages', {
      ...usage,
      createdAt: new Date().toISOString()
    } as any);

    // 🚀 [단일 업무 인계 파이프라인] 부서장에게 휴가 승인 ToDo 발행
    const applicant = db.users.find(u => u.id === usage.userId);
    await issueHandoverTask({
      category: 'LEAVE_OT_APPROVAL',
      title: `[휴가 승인 요망] ${applicant?.name || '임직원'} (${usage.leaveType || '연차'})`,
      content: `${applicant?.name || '임직원'} 휴가 신청 (${usage.startDate} ~ ${usage.endDate}, ${usage.usedDays}일). 사유: ${usage.reason || '-'}`,
      targetRole: 'MANAGER',
      priority: 'NORMAL',
      actionUrl: '/admin/leave_management',
      entityType: 'LEAVE',
      entityId: newLeave.id,
      senderId: currentUser?.id,
      senderName: currentUser?.name
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const deleteLeaveUsage = async (id: string) => {
    db.deleteRow('leaveUsages', id);
    await clearHandoverTasks({
      entityType: 'LEAVE',
      entityId: id,
      completionAction: 'LEAVE_DELETED'
    });
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const addOvertimeRecord = async (record: Omit<OvertimeRecord, 'id' | 'createdAt'>) => {
    const newOt = db.insertRow<OvertimeRecord>('overtimeRecords', {
      ...record,
      createdAt: new Date().toISOString()
    } as any);

    const applicant = db.users.find(u => u.id === record.userId);
    await issueHandoverTask({
      category: 'LEAVE_OT_APPROVAL',
      title: `[초과근무 승인 요망] ${applicant?.name || '임직원'} (${record.hours}시간)`,
      content: `${applicant?.name || '임직원'} 연장/야간 근무 신청 (${record.startDateTime?.substring(0, 10)}, ${record.hours}시간). 사유: ${record.workDetail || '-'}`,
      targetRole: 'MANAGER',
      priority: 'NORMAL',
      actionUrl: '/admin/ot_management',
      entityType: 'OT',
      entityId: newOt.id,
      senderId: currentUser?.id,
      senderName: currentUser?.name
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const deleteOvertimeRecord = async (id: string) => {
    db.deleteRow('overtimeRecords', id);
    await clearHandoverTasks({
      entityType: 'LEAVE',
      entityId: id,
      completionAction: 'OT_DELETED'
    });
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const setPayrollClosingStatus = async (month: string, status: 'DRAFT' | 'APPROVED', approvedBy?: string) => {
    const existing = db.payrollClosings.find(p => p.month === month);
    if (existing) {
      db.updateRow<PayrollClosing>('payrollClosings', existing.id, {
        status,
        approvedAt: status === 'APPROVED' ? new Date().toISOString() : undefined,
        approvedBy: status === 'APPROVED' ? approvedBy : undefined,
        updatedAt: new Date().toISOString()
      } as any);
    } else {
      db.insertRow<PayrollClosing>('payrollClosings', {
        month,
        status,
        approvedAt: status === 'APPROVED' ? new Date().toISOString() : undefined,
        approvedBy: status === 'APPROVED' ? approvedBy : undefined,
        createdAt: new Date().toISOString()
      } as any);
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const dispatchDelivery = (
    deliveryId: string, 
    dispatchData: { 
      scheduledDate: string; 
      transportCompany: string; 
      vehicleType: string; 
      vehicleNo: string; 
      driverName: string; 
      driverContact: string; 
      deliveryCost: number; 
      vehiclesJson?: string;
    }
  ) => {
    db.updateRow<Delivery>('deliveries', deliveryId, {
      scheduledDate: dispatchData.scheduledDate,
      transportCompany: dispatchData.transportCompany,
      vehicleType: dispatchData.vehicleType,
      vehicleNo: dispatchData.vehicleNo,
      driverName: dispatchData.driverName,
      driverContact: dispatchData.driverContact,
      deliveryCost: dispatchData.deliveryCost,
      vehicles: dispatchData.vehiclesJson,
      status: 'DISPATCHED',
      updatedAt: new Date().toISOString()
    });
    refreshAllData();

    // 📢 배차 완료 시 관련 부서(영업/출고/관리/경영)에 실시간 알림 브로드캐스트
    const dObj = db.deliveries.find(d => d.id === deliveryId);
    const dContract = dObj?.contractId ? db.contracts.find(c => c.id === dObj.contractId) : null;
    const dCust = dContract ? db.customers.find(c => c.id === dContract.customerId)?.name : '';
    const dSite = dContract ? db.sites.find(s => s.id === dContract.siteId)?.name : '';
    broadcastWorkNotification({
      type: 'DISPATCH',
      title: '배차 완료 안내',
      body: `${dCust || '현장'} (${dSite || '배차'}) ${dispatchData.driverName || '기사'} (${dispatchData.vehicleType || '화물'}) 배차 완료`,
      url: '/admin/dispatch',
      targetDepts: ['SALES', 'YARD', 'ADMIN', 'EXECUTIVE']
    }).catch(console.warn);
  };

  const settleDeliveryCost = (deliveryId: string, deliveryCostConfirmed: number, vehiclesJson?: string) => {
    db.updateRow<Delivery>('deliveries', deliveryId, {
      isCostSettled: true,
      deliveryCostConfirmed,
      vehicles: vehiclesJson,
      updatedAt: new Date().toISOString()
    });
    refreshAllData();
  };

  const completeDelivery = async (deliveryId: string) => {
    const delivery = db.deliveries.find(d => d.id === deliveryId);
    if (!delivery) return;

    db.updateRow<Delivery>('deliveries', deliveryId, {
      status: 'COMPLETED',
      updatedAt: new Date().toISOString()
    });

    const contract = delivery.contractId ? db.contracts.find(c => c.id === delivery.contractId) : null;
    const customer = contract ? db.customers.find(c => c.id === contract.customerId) : null;
    const site = contract ? db.sites.find(s => s.id === contract.siteId) : null;

    // INBOUND (회수) 완료 시 장비를 대기중(AVAILABLE)으로 복원 및 계약 완료 처리
    if (delivery.type === 'INBOUND' && delivery.contractId) {
      const cAssets = db.contractAssets.filter(ca => ca.contractId === delivery.contractId);
      cAssets.forEach(ca => {
        if (ca.assetId) {
          const asset = db.assets.find(a => a.id === ca.assetId);
          db.updateRow<Asset>('assets', ca.assetId, {
            status: 'AVAILABLE',
            currentCustomerId: '',
            currentSiteId: '',
            contractStart: '',
            contractEnd: '',
            monthlyRentalFee: 0,
            dailyRentalFee: 0,
            updatedAt: new Date().toISOString()
          });

          if (asset) {
            // 입고 이력 추가 (기본 점수 0, 특이사항 없음)
            db.insertRow<AssetInOutLog>('assetInOutLogs', {
              assetId: asset.id,
              assetNo: asset.assetNo,
              modelName: asset.modelName,
              type: 'INBOUND',
              eventDate: new Date().toISOString().split('T')[0],
              customerId: contract?.customerId,
              customerName: customer?.name || '',
              siteId: contract?.siteId,
              siteName: site?.name || '',
              deliveryId: deliveryId,
              maintenanceScore: asset.maintenanceScore || 0,
              memo: '일반 배차 반납 입고',
              createdAt: new Date().toISOString()
            });
          }
        }
      });

      db.updateRow<Contract>('contracts', delivery.contractId, {
        status: 'COMPLETED',
        updatedAt: new Date().toISOString()
      });
    }

    // OUTBOUND (출고) 완료 시 계약 활성화 및 출고 이력 생성
    if (delivery.type === 'OUTBOUND' && delivery.contractId) {
      if (contract && contract.status !== 'COMPLETED') {
        db.updateRow<Contract>('contracts', delivery.contractId, {
          status: 'ACTIVE',
          updatedAt: new Date().toISOString()
        });

        // OUTBOUND 로그 추가 (중복 방지 가드)
        const cAssets = db.contractAssets.filter(ca => ca.contractId === delivery.contractId);
        cAssets.forEach(ca => {
          if (ca.assetId) {
            const asset = db.assets.find(a => a.id === ca.assetId);
            if (asset) {
              const alreadyLogged = db.assetInOutLogs.some(
                l => l.assetId === asset.id && l.type === 'OUTBOUND' && l.deliveryId === deliveryId
              );
              if (!alreadyLogged) {
                db.insertRow<AssetInOutLog>('assetInOutLogs', {
                  assetId: asset.id,
                  assetNo: asset.assetNo,
                  modelName: asset.modelName,
                  type: 'OUTBOUND',
                  eventDate: delivery.scheduledDate || new Date().toISOString().split('T')[0],
                  customerId: contract.customerId,
                  customerName: customer?.name || '',
                  siteId: contract.siteId,
                  siteName: site?.name || '',
                  deliveryId: deliveryId,
                  createdAt: new Date().toISOString()
                });
              }
            }
          }
        });
      }
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const completeInboundDelivery = async (
    deliveryId: string,
    actualReturnDate: string,
    reviews: { assetId: string; status: 'AVAILABLE' | 'REPAIRING'; maintenanceScore: number; memo: string; faultImageUrl?: string }[]
  ) => {
    const delivery = db.deliveries.find(d => d.id === deliveryId);
    if (!delivery) return;

    db.updateRow<Delivery>('deliveries', deliveryId, {
      status: 'COMPLETED',
      updatedAt: new Date().toISOString()
    });

    const contract = delivery.contractId ? db.contracts.find(c => c.id === delivery.contractId) : null;
    const customer = contract ? db.customers.find(c => c.id === contract.customerId) : null;
    const site = contract ? db.sites.find(s => s.id === contract.siteId) : null;

    reviews.forEach(review => {
      const asset = db.assets.find(a => a.id === review.assetId);
      if (!asset) return;

      db.updateRow<Asset>('assets', review.assetId, {
        status: review.status,
        maintenanceScore: review.maintenanceScore,
        currentCustomerId: '',
        currentSiteId: '',
        contractStart: '',
        contractEnd: '',
        updatedAt: new Date().toISOString()
      });

      db.insertRow<AssetInOutLog>('assetInOutLogs', {
        assetId: asset.id,
        assetNo: asset.assetNo,
        modelName: asset.modelName,
        type: 'INBOUND',
        eventDate: actualReturnDate,
        customerId: contract?.customerId || '',
        customerName: customer?.name || '',
        siteId: contract?.siteId || '',
        siteName: site?.name || '',
        deliveryId: deliveryId,
        maintenanceScore: review.maintenanceScore,
        memo: review.memo,
        createdAt: new Date().toISOString()
      });

      if (review.status === 'REPAIRING') {
        db.insertRow<Repair>('repairs', {
          assetId: asset.id,
          details: `스마트 입고 검수 시 등록됨: ${review.memo}`,
          status: 'PENDING',
          requestDate: actualReturnDate,
          totalCost: 0,
          billableToCustomer: false,
          isCustomerFault: true,
          faultImageUrl: review.faultImageUrl || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    if (delivery.contractId) {
      const isExchange = delivery.type === 'EXCHANGE' || delivery.dispatchCategory === '교환';
      const reviewedAssetIds = reviews.map(r => r.assetId);
      const cAssets = db.contractAssets.filter(ca => ca.contractId === delivery.contractId);

      if (isExchange) {
        // 교환(EXCHANGE) 배차: 계약은 계속 진행(ACTIVE)되므로 완료시키지 않음
        // 회수 검수된 장비 슬롯만 RETURNED 처리 (대차로 투입된 장비는 계속 RENTED 유지)
        cAssets.forEach(ca => {
          if (ca.assetId && reviewedAssetIds.includes(ca.assetId)) {
            db.updateRow<ContractAsset>('contractAssets', ca.id, {
              status: 'RETURNED',
              actualReturnDate: ca.actualReturnDate || actualReturnDate,
              updatedAt: new Date().toISOString()
            });
          }
        });
      } else {
        // 일반 입고/반납 배차: 검수된 자산 슬롯 RETURNED 처리
        cAssets.forEach(ca => {
          if (reviewedAssetIds.length === 0 || (ca.assetId && reviewedAssetIds.includes(ca.assetId))) {
            db.updateRow<ContractAsset>('contractAssets', ca.id, {
              status: 'RETURNED',
              actualReturnDate: ca.actualReturnDate || actualReturnDate,
              updatedAt: new Date().toISOString()
            });
          }
        });

        // 계약에 남은 대여/체결 자산 슬롯이 있는지 확인
        const remainingActiveAssets = cAssets.filter(ca => 
          !(ca.assetId && reviewedAssetIds.includes(ca.assetId)) && ca.status !== 'RETURNED'
        );

        // 모든 장비가 회수 완료되었을 때만 계약을 COMPLETED로 종료
        if (remainingActiveAssets.length === 0) {
          db.updateRow<Contract>('contracts', delivery.contractId, {
            status: 'COMPLETED',
            updatedAt: new Date().toISOString()
          });
        }
      }
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 💡 [사장님 지시] 입고 등록 (입고번호, 하위번호 INB-XXXX-01, 증상별 사진 및 자산정비수리 자동연동, 불량 시 REPAIRING 전환)
  const registerInboundAsset = async (data: {
    assetId: string;
    returnDate: string;
    maintenanceScore?: number;
    memo?: string;
    inboundNo?: string;
    defects?: InboundDefectDetail[];
    photos?: string[];
    otherDefectText?: string;
    targetAssetStatus?: Asset['status'];
  }) => {
    const asset = db.assets.find(a => a.id === data.assetId);
    if (!asset) throw new Error('해당 자산을 찾을 수 없습니다.');

    // 대여 중인 계약 자산 탐색 (유연 매칭: RENTED 우선 탐색 후 미반납 체결 계약 포괄 탐색)
    const ca = db.contractAssets.find(c => c.assetId === data.assetId && c.status === 'RENTED') ||
               db.contractAssets.find(c => c.assetId === data.assetId && c.status !== 'RETURNED') ||
               db.contractAssets.find(c => c.assetId === data.assetId);
    const contract = ca ? db.contracts.find(ct => ct.id === ca.contractId) : null;
    const customer = contract ? db.customers.find(cu => cu.id === contract.customerId) : null;
    const site = contract ? db.sites.find(s => s.id === contract.siteId) : null;

    const score = data.maintenanceScore || 0;
    const hasDefect = score > 0 || (data.defects && data.defects.length > 0) || Boolean(data.otherDefectText);
    // 자산 상태: 점수 0점이고 결함 없으면 AVAILABLE(임대가능), 이상 시 REPAIRING(정비중) 또는 전달된 targetAssetStatus
    const nextAssetStatus: Asset['status'] = data.targetAssetStatus || (!hasDefect ? 'AVAILABLE' : 'REPAIRING');

    // 💡 [입고 번호 채번]
    const assignedInboundNo = data.inboundNo || db.generateNextId('inboundNo', db.assetInOutLogs as any);

    // 💡 [불량 증상 하위 번호 결합 (예: INB-20260809-001-01)]
    const processedDefects: InboundDefectDetail[] = (data.defects || []).map((d, idx) => ({
      ...d,
      subNo: d.subNo || `${assignedInboundNo}-${String(idx + 1).padStart(2, '0')}`
    }));

    const defectsJsonStr = processedDefects.length > 0 ? JSON.stringify(processedDefects) : undefined;
    const defectSummary = processedDefects.map(d => `[${d.subNo}] ${d.checkitemName}(+${d.score}점)`).join(', ');
    const fullDefectSummary = [defectSummary, data.otherDefectText ? `[기타] ${data.otherDefectText}` : ''].filter(Boolean).join(' | ');

    // 1. 자산 마스터 갱신 (정비필요항목 note 저장)
    db.updateRow<Asset>('assets', asset.id, {
      status: nextAssetStatus,
      maintenanceScore: score,
      note: hasDefect ? fullDefectSummary : (score === 0 ? '정상 입고 점검 완료' : asset.note),
      currentCustomerId: '',
      currentSiteId: '',
      contractStart: '',
      contractEnd: '',
      updatedAt: new Date().toISOString()
    });

    // 2. 계약 자산 반납 갱신
    if (ca) {
      db.updateRow<ContractAsset>('contractAssets', ca.id, {
        status: 'RETURNED',
        actualReturnDate: data.returnDate,
        updatedAt: new Date().toISOString()
      });
    }

    // 3. 자산 정비수리 대장 연동 (결함 발생 시 자동 PENDING 정비 건 발행)
    let createdRepairId: string | undefined = undefined;
    if (hasDefect) {
      const repairId = db.generateNextId('repairs', db.repairs);
      createdRepairId = repairId;
      
      db.insertRow<Repair>('repairs', {
        id: repairId,
        assetId: asset.id,
        assetNo: asset.assetNo,
        modelName: asset.modelName,
        contractId: contract?.id,
        customerId: customer?.id,
        customerName: customer?.name || '입고 점검처',
        siteId: site?.id,
        siteName: site?.name || '주기장',
        requestDate: data.returnDate,
        status: 'PENDING',
        workCategory: 'YARD_INTERNAL',
        workLocation: 'YARD',
        source: 'INBOUND_INSPECTION',
        details: `입고검수 자동 정비 접수: ${assignedInboundNo}\n정비 필요 항목: ${fullDefectSummary}\n비고: ${data.memo || '이상 무'}`,
        totalCost: 0,
        billableToCustomer: false,
        inboundNo: assignedInboundNo,
        defectsJson: defectsJsonStr,
        evidenceImages: data.photos || [],
        targetAssetStatus: 'REPAIRING',
        inspectionItemCode: processedDefects.length > 0 ? processedDefects.map(d => d.checkitemId).join(',') : undefined,
        degradationScore: score,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 🚀 [단일 업무 인계 파이프라인] 주기장 정비팀에 입고 정비 ToDo 영구 적재
      await issueHandoverTask({
        category: 'INBOUND_REPAIR_DEFECT',
        title: `[입고 장비 정비] ${asset.assetNo} (${asset.modelName})`,
        content: `입고 결함 발견 (+${score}점): ${fullDefectSummary || '정비 요망'}`,
        targetDept: 'YARD',
        priority: score >= 5 ? 'HIGH' : 'NORMAL',
        actionUrl: '/repairs',
        entityType: 'REPAIR',
        entityId: repairId,
        senderId: currentUser?.id,
        senderName: currentUser?.name
      });
    }

    // 🟢 회수 배차 및 관련 선행 ToDo 자동 상계
    await clearHandoverTasks({
      entityId: asset.id,
      completionAction: 'INBOUND_REGISTERED'
    });
    if (contract?.id) {
      await clearHandoverTasks({
        entityId: contract.id,
        category: 'DISPATCH_REQUEST',
        completionAction: 'INBOUND_REGISTERED'
      });
    }

    // 4. 자산 입출고 이력 무누락 기록 (INBOUND)
    db.insertRow<AssetInOutLog>('assetInOutLogs', {
      assetId: asset.id,
      assetNo: asset.assetNo,
      modelName: asset.modelName,
      type: 'INBOUND',
      inboundNo: assignedInboundNo,
      eventDate: data.returnDate,
      customerId: customer?.id || '',
      customerName: customer?.name || '',
      siteId: site?.id || '',
      siteName: site?.name || '',
      repairId: createdRepairId,
      maintenanceScore: score,
      defectsJson: defectsJsonStr,
      memo: data.memo || (hasDefect ? `불량 입고 등록 (${fullDefectSummary})` : '정상 입고 등록 완결'),
      createdAt: new Date().toISOString()
    });

    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 💡 [사장님 지시] 입고 취소 롤백 (휴먼에러 복원 및 INBOUND_CANCEL 히스토리 무누락 저장)
  const cancelInboundAsset = async (logId: string, cancelReason?: string) => {
    const log = db.assetInOutLogs.find(l => l.id === logId && l.type === 'INBOUND');
    if (!log) throw new Error('해당 입고 이력 로그를 찾을 수 없거나 이미 취소된 건입니다.');

    const asset = db.assets.find(a => a.id === log.assetId);
    if (!asset) throw new Error('연관 자산을 찾을 수 없습니다.');

    // 1. 자산 상태 RENTED(대여중)로 복원
    db.updateRow<Asset>('assets', asset.id, {
      status: 'RENTED',
      currentCustomerId: log.customerId || asset.currentCustomerId,
      currentSiteId: log.siteId || asset.currentSiteId,
      updatedAt: new Date().toISOString()
    });

    // 2. 계약 체결 자산 RENTED(대여중)로 복원
    const ca = db.contractAssets.find(c => c.assetId === asset.id);
    if (ca) {
      db.updateRow<ContractAsset>('contractAssets', ca.id, {
        status: 'RENTED',
        actualReturnDate: undefined,
        updatedAt: new Date().toISOString()
      });
    }

    // 3. 기존 오등록 입고 로그 삭제 및 계약 이력에 롤백 로그 무누락 생성
    db.deleteRow('assetInOutLogs', logId);

    if (ca?.contractId) {
      db.insertRow<ContractHistory>('contractHistory', {
        contractId: ca.contractId,
        changeType: 'TERMINATE',
        changeDate: new Date().toISOString().split('T')[0],
        description: `[입고 취소 롤백] 자산(${asset.assetNo}) 오등록 입고 취소 ➔ 대여중(RENTED) 복원 (사유: ${cancelReason || '사용자 휴먼에러 입고 취소'})`,
        createdAt: new Date().toISOString()
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const registerRepair = async (repairData: Partial<Repair>, usedConsumables: { consumableId: string; quantity: number }[]) => {
    const repairId = repairData.id || db.generateNextId('repairs', db.repairs);
    const totalRepairCost = repairData.totalCost ?? 0;
    const maintenanceType = repairData.maintenanceType || (repairData.repairType === 'EXTERNAL' ? 'EXTERNAL' : 'INHOUSE_REPAIR');
    const repairStatus = repairData.status || 'COMPLETED';

    const targetAsset = db.assets.find(a => a.id === repairData.assetId);
    let resolvedCustomerName = repairData.customerName || '';
    let resolvedSiteName = repairData.siteName || '';
    let resolvedContractId = repairData.contractId;

    // 대여중 장비인 경우 현재 계약의 고객사/현장 자동 매핑
    if (targetAsset && targetAsset.status === 'RENTED') {
      const activeContractAsset = db.contractAssets.find(ca => ca.assetId === targetAsset.id && ca.status !== 'RETURNED');
      if (activeContractAsset) {
        const activeContract = db.contracts.find(c => c.id === activeContractAsset.contractId);
        if (activeContract) {
          resolvedContractId = resolvedContractId || activeContract.id;
          const cust = db.customers.find(cu => cu.id === activeContract.customerId);
          const st = db.sites.find(s => s.id === activeContract.siteId);
          resolvedCustomerName = cust?.name || resolvedCustomerName;
          resolvedSiteName = st?.name || resolvedSiteName;
        }
      }
    }

    if (repairData.id) {
      db.updateRow<Repair>('repairs', repairData.id, {
        ...repairData,
        contractId: resolvedContractId,
        maintenanceType,
        status: repairStatus,
        customerName: resolvedCustomerName,
        siteName: resolvedSiteName,
        updatedAt: new Date().toISOString()
      });
    } else {
      db.insertRow<Repair>('repairs', {
        id: repairId,
        contractId: resolvedContractId,
        assetId: repairData.assetId || '',
        assetNo: targetAsset?.assetNo || repairData.assetNo || '현장확인',
        modelName: targetAsset?.modelName || repairData.modelName || '고소작업대',
        mechanicId: repairData.mechanicId || currentUser?.id || '',
        maintenanceType,
        repairType: repairData.repairType || (maintenanceType === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL'),
        requestDate: repairData.requestDate || new Date().toISOString().split('T')[0],
        scheduleDate: repairData.scheduleDate,
        repairDate: repairData.repairDate || new Date().toISOString().split('T')[0],
        status: repairStatus,
        unresolvedReason: repairData.unresolvedReason,
        nextAction: repairData.nextAction,
        targetAssetStatus: repairData.targetAssetStatus,
        vendorId: repairData.vendorId,
        details: repairData.details || '',
        totalCost: totalRepairCost,
        billableType: repairData.billableType || (repairData.billableToCustomer ? 'BILLABLE' : 'FREE'),
        billableAmount: repairData.billableAmount || 0,
        billableToCustomer: repairData.billableType === 'BILLABLE' || repairData.billableToCustomer || false,
        inspectionItemId: repairData.inspectionItemId,
        inspectionItemCode: repairData.inspectionItemCode,
        degradationScore: repairData.degradationScore || 0,
        durationMinutes: repairData.durationMinutes,
        spentManHours: repairData.spentManHours ?? (repairData.durationMinutes ? repairData.durationMinutes / 60 : undefined),
        beforeImage: repairData.beforeImage || '',
        afterImage: repairData.afterImage || '',
        evidenceImages: repairData.evidenceImages || [],
        workLocation: repairData.workLocation || 'YARD',
        stockSource: repairData.stockSource || 'YARD_STOCK',
        customerName: resolvedCustomerName,
        siteName: resolvedSiteName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

    // 소모품 재고 차감: 주기장 정비(YARD)이거나 stockSource가 YARD_STOCK/CENTRAL_HQ인 경우 주기장 재고에서 우선 차감
    const isYardDepotRepair = repairData.workLocation === 'YARD' || repairData.stockSource === 'YARD_STOCK' || repairData.stockSource === 'CENTRAL_HQ' || maintenanceType === 'INHOUSE_REPAIR';
    const effectiveMechanicId = repairData.mechanicId || currentUser?.id;
    const mechanic = db.users.find(u => u.id === effectiveMechanicId);
    const mechanicName = mechanic?.name || '정비사';

    usedConsumables.forEach(uc => {
      const consumable = db.consumables.find(c => c.id === uc.consumableId);
      if (!consumable) return;

      const mechanicStock = (!isYardDepotRepair && effectiveMechanicId)
        ? db.mechanicConsumableStocks.find(s => s.mechanicId === effectiveMechanicId && s.consumableId === uc.consumableId)
        : null;

      if (mechanicStock && mechanicStock.stockQty >= uc.quantity) {
        // 1. 기사 차량 재고에서 차감 (현장 출장 AS인 경우)
        db.updateRow<MechanicConsumableStock>('mechanicConsumableStocks', mechanicStock.id, {
          stockQty: mechanicStock.stockQty - uc.quantity,
          updatedAt: new Date().toISOString()
        });

        db.insertRow<ConsumableLog>('consumableLogs', {
          consumableId: consumable.id,
          type: 'OUTBOUND',
          quantity: uc.quantity,
          unitPrice: consumable.unitPrice,
          targetAssetId: repairData.assetId,
          userId: currentUser?.id,
          mechanicId: effectiveMechanicId,
          fromLocation: `${mechanicName} 차량`,
          toLocation: `현장 장비(${targetAsset?.assetNo || 'N/A'})`,
          actionDate: repairData.repairDate || new Date().toISOString().split('T')[0],
          description: `[차량재고 소진] 정비(${repairId}) ${mechanicName} 차량에서 현장 투입`,
          createdAt: new Date().toISOString()
        });
      } else {
        // 2. 주기장 재고에서 차감 (주기장 정비 또는 본사 불출)
        const nextQty = Math.max(0, (consumable.stockQty || 0) - uc.quantity);
        db.updateRow<Consumable>('consumables', consumable.id, {
          stockQty: nextQty,
          updatedAt: new Date().toISOString()
        });

        db.insertRow<ConsumableLog>('consumableLogs', {
          consumableId: consumable.id,
          type: 'OUTBOUND',
          quantity: uc.quantity,
          unitPrice: consumable.unitPrice,
          targetAssetId: repairData.assetId,
          userId: currentUser?.id,
          fromLocation: '주기장 재고',
          toLocation: `주기장 장비(${targetAsset?.assetNo || 'N/A'})`,
          actionDate: repairData.repairDate || new Date().toISOString().split('T')[0],
          description: `[주기장 재고 투입] 정비(${repairId}) 주기장 수리 부품 투입`,
          createdAt: new Date().toISOString()
        });
      }

      db.insertRow<RepairConsumable>('repairConsumables', {
        repairId,
        consumableId: uc.consumableId,
        quantity: uc.quantity,
        unitPrice: consumable.unitPrice,
        cost: consumable.unitPrice * uc.quantity
      });
    });

    // 🏛️ 자산 상태 라이프사이클 무왜곡 정합성 보장 (헌장 카테고리 1.2, 1.3)
    if (targetAsset) {
      const isRentedAsset = targetAsset.status === 'RENTED';
      const isFieldAS = maintenanceType === 'EMERGENCY_AS' || maintenanceType === 'PREVENTIVE';

      let nextAssetStatus: Asset['status'] = targetAsset.status;
      let nextMaintenanceScore = targetAsset.maintenanceScore || 0;

      if (isRentedAsset && isFieldAS) {
        // 🚨 임대중 현장 출장정비: 장비는 현장에 계속 있으므로 'RENTED' 상태 100% 보존!
        nextAssetStatus = 'RENTED';
        if (repairStatus === 'COMPLETED') {
          nextMaintenanceScore = 0; // 정비 완료 시 이상무 리셋
        }
      } else if (repairData.targetAssetStatus) {
        // 🌟 주기장 정비 판정 명시적 전이 (AVAILABLE, REPAIRING 등)
        nextAssetStatus = repairData.targetAssetStatus;
        if (nextAssetStatus === 'AVAILABLE') {
          nextMaintenanceScore = 0; // 임대가능 복귀 시 정비점수 초기화
        }
      } else if (repairStatus === 'COMPLETED' && (targetAsset.status === 'REPAIRING' || targetAsset.status === 'RENTED_RETURNED')) {
        // 기본값: 입고검수/수리중 장비의 정비 완료 시 AVAILABLE로 자동 전이
        nextAssetStatus = 'AVAILABLE';
        nextMaintenanceScore = 0;
      }

      let nextNote = targetAsset.note;
      if (repairStatus === 'COMPLETED' && nextAssetStatus === 'AVAILABLE') {
        const dateTag = repairData.repairDate || new Date().toISOString().split('T')[0];
        const detailSnippet = repairData.details ? repairData.details.slice(0, 30) : '점검 완료';
        nextNote = `[정비완료 ${dateTag}] ${detailSnippet}`;
      }

      db.updateRow<Asset>('assets', targetAsset.id, {
        status: nextAssetStatus,
        maintenanceScore: nextMaintenanceScore,
        cumRepairCost: (targetAsset.cumRepairCost || 0) + totalRepairCost,
        note: nextNote,
        updatedAt: new Date().toISOString()
      });

      // 정비 수리 이력 로그 (AssetInOutLog) 무누락 기록
      const typeLabel = maintenanceType === 'EMERGENCY_AS' ? '긴급출장정비' :
        maintenanceType === 'PREVENTIVE' ? '정기예방정비' :
        maintenanceType === 'EXTERNAL' ? '외주정비' : '야적장자사정비';

      let memoText = `[${typeLabel}] `;
      if (repairStatus === 'COMPLETED') {
        memoText += `정비 완료 (비용: ${totalRepairCost.toLocaleString()}원) ➔ 자산상태 [${nextAssetStatus}] 전이: ${repairData.details || ''}`;
      } else if (repairStatus === 'UNRESOLVED') {
        memoText += `미완료 (${repairData.unresolvedReason || '사유미기재'}, 후속: ${repairData.nextAction || '없음'}): ${repairData.details || ''}`;
      } else {
        memoText += `정비 진행중 (스케줄: ${repairData.scheduleDate || repairData.requestDate}): ${repairData.details || ''}`;
      }

      db.insertRow<AssetInOutLog>('assetInOutLogs', {
        assetId: targetAsset.id,
        assetNo: targetAsset.assetNo,
        modelName: targetAsset.modelName,
        type: 'REPAIR',
        eventDate: repairData.repairDate || repairData.requestDate || new Date().toISOString().split('T')[0],
        repairId: repairId,
        inboundNo: repairData.inboundNo,
        maintenanceScore: nextMaintenanceScore,
        memo: memoText,
        createdAt: new Date().toISOString()
      });
    }

    // 📜 계약 이력(ContractHistory) 무누락 타임라인 자동 연동
    if (resolvedContractId && repairStatus === 'COMPLETED') {
      db.insertRow<ContractHistory>('contract_history', {
        id: `ch-rep-${repairId}-${Date.now()}`,
        contractId: resolvedContractId,
        changeType: 'AS_SERVICE',
        changeDate: repairData.repairDate || repairData.requestDate || new Date().toISOString().split('T')[0],
        description: `[현장 정비/AS 완료] ${repairData.details || '정비 완료'} (${targetAsset ? `장비: ${targetAsset.assetNo}` : '현장확인'}${mechanicName ? `, 정비사: ${mechanicName}` : ''}${totalRepairCost > 0 ? `, 비용: ₩${totalRepairCost.toLocaleString()}` : ''})`,
        createdAt: new Date().toISOString()
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const updateRepairStatus = async (
    repairId: string, 
    status: Repair['status'], 
    unresolvedReason?: string, 
    nextAction?: Repair['nextAction'],
    targetAssetStatus?: Asset['status']
  ) => {
    const existing = db.repairs.find(r => r.id === repairId);
    if (!existing) return;

    const today = new Date().toISOString().split('T')[0];
    db.updateRow<Repair>('repairs', repairId, {
      status,
      repairDate: status === 'COMPLETED' ? today : existing.repairDate,
      unresolvedReason: unresolvedReason ?? existing.unresolvedReason,
      nextAction: nextAction ?? existing.nextAction,
      targetAssetStatus: targetAssetStatus ?? existing.targetAssetStatus,
      updatedAt: new Date().toISOString()
    });

    // 🌟 자산 상태 전이 명시적 지원
    if (existing.assetId && targetAssetStatus) {
      const targetAsset = db.assets.find(a => a.id === existing.assetId);
      if (targetAsset) {
        db.updateRow<Asset>('assets', targetAsset.id, {
          status: targetAssetStatus,
          maintenanceScore: targetAssetStatus === 'AVAILABLE' ? 0 : targetAsset.maintenanceScore,
          updatedAt: new Date().toISOString()
        });
        db.insertRow<AssetInOutLog>('assetInOutLogs', {
          assetId: targetAsset.id,
          assetNo: targetAsset.assetNo,
          modelName: targetAsset.modelName,
          type: 'REPAIR',
          eventDate: today,
          repairId: repairId,
          maintenanceScore: targetAssetStatus === 'AVAILABLE' ? 0 : targetAsset.maintenanceScore,
          memo: `[주기장 정비 상태 갱신] ${status} ➔ 자산상태 [${targetAssetStatus}] 전이`,
          createdAt: new Date().toISOString()
        });
      }
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const saveTransportDataOnFly = (companyName: string, driverName: string, contact: string, vehicleNo: string, vehicleType: string) => {
    if (!companyName && !driverName) return;

    let companyId = '';
    
    // 1. 운송업체 처리
    if (companyName) {
      const existingCompany = db.transportCompanies.find(c => c.name === companyName);
      if (existingCompany) {
        companyId = existingCompany.id;
      } else {
        const newCompany = db.insertRow<TransportCompany>('transportCompanies', {
          name: companyName,
          businessNo: '',
          contact: contact || '',
          memo: '자동 추가됨',
          createdAt: new Date().toISOString()
        });
        companyId = newCompany.id;
      }
    }

    // 2. 기사 처리
    if (driverName) {
      const existingDriver = db.transportDrivers.find(d => 
        d.driverName === driverName && (companyId ? d.companyId === companyId : true)
      );
      if (!existingDriver) {
        db.insertRow<TransportDriver>('transportDrivers', {
          companyId: companyId,
          driverName: driverName,
          driverContact: contact || '',
          vehicleNo: vehicleNo || '',
          vehicleType: vehicleType || '',
          createdAt: new Date().toISOString()
        });
      }
    }
    
    refreshAllData();
  };

  const saveCashFlowSnapshot = (snap: Omit<CashFlowSnapshot, 'id' | 'createdAt'>) => {
    db.insertRow<CashFlowSnapshot>('cashFlowSnapshots', {
      ...snap,
      createdAt: new Date().toISOString()
    });
    refreshAllData();
  };

  const deleteCashFlowSnapshot = (snapId: string) => {
    db.deleteRow('cashFlowSnapshots', snapId);
    refreshAllData();
  };

  const saveVendor = async (vendor: Vendor): Promise<void> => {
    try {
      const existing = db.vendors.find(v => v.id === vendor.id);
      if (existing) {
        db.updateRow('vendors', vendor.id, vendor);
      } else {
        db.insertRow('vendors', vendor);
      }
      // Supabase 비동기 쓰기 큐 완료 대기 및 에러 전파
      if (db.pendingWrites.length > 0) {
        await db.awaitPendingWrites();
      }
      refreshAllData();
    } catch (err: any) {
      console.error('saveVendor error:', err);
      throw err;
    }
  };

  const deleteVendor = (id: string) => {
    // ✅ 고아 레코드 방지: 연관 자산 또는 매입 정산건이 있으면 삭제 차단
    const linkedAssets = db.assets.filter(a => a.vendorId === id);
    const linkedSettlements = db.purchaseSettlements.filter(s => s.vendorId === id);
    if (linkedAssets.length > 0 || linkedSettlements.length > 0) {
      showErrorModal(
        `⚠️ 해당 매입처를 삭제할 수 없습니다.\n\n` +
        (linkedAssets.length > 0 ? `■ 연결된 자산: ${linkedAssets.length}대\n` : '') +
        (linkedSettlements.length > 0 ? `■ 연결된 매입 정산건: ${linkedSettlements.length}건\n` : '') +
        `\n연결된 자산/정산을 먼저 해제한 후 삭제하십시오.`,
        '매입처 삭제 불가'
      );
      return;
    }
    db.deleteRow('vendors', id);
    refreshAllData();
  };

  // 💡 전사 매입처 거래개시일 및 매입누적거래액 일괄 재집계/동기화 헬퍼 (헌장 4.1, 5.2)
  const recalculateAllVendorMetrics = async (): Promise<{ updatedCount: number; totalAmount: number }> => {
    let updatedCount = 0;
    let grandTotal = 0;
    const allVendors = [...db.vendors];
    const allAssets = db.assets.filter(a => a.ownerType === 'OWNED');
    const allSettlements = db.purchaseSettlements;

    for (const v of allVendors) {
      const matchedAssets = allAssets.filter(a => 
        (a.vendorId && a.vendorId === v.id) || 
        (a.supplier && (a.supplier === v.name || a.supplier.includes(v.name) || v.name.includes(a.supplier)))
      );
      const assetTotal = matchedAssets.reduce((sum, a) => sum + (a.acquisitionPrice || 0), 0);
      
      const matchedSettlements = allSettlements.filter(s => 
        (s.vendorId && s.vendorId === v.id) || 
        (s.vendorName && (s.vendorName === v.name || s.vendorName.includes(v.name) || v.name.includes(s.vendorName)))
      );
      const settlementTotal = matchedSettlements.reduce((sum, s) => sum + (s.totalAmount || 0), 0);
      const totalAmount = assetTotal + settlementTotal;
      grandTotal += totalAmount;

      const tradeDates: string[] = [];
      if (v.firstTradeDate) tradeDates.push(v.firstTradeDate);
      matchedAssets.forEach(a => { if (a.acquisitionDate) tradeDates.push(a.acquisitionDate); });
      matchedSettlements.forEach(s => {
        if (s.paymentDate) tradeDates.push(s.paymentDate);
        else if (s.settlementYm) tradeDates.push(`${s.settlementYm}-01`);
      });
      tradeDates.sort();
      const firstTradeDate = tradeDates.length > 0 ? tradeDates[0] : v.firstTradeDate;
      const lastTradeDate = tradeDates.length > 0 ? tradeDates[tradeDates.length - 1] : v.lastTradeDate;

      db.updateRow<Vendor>('vendors', v.id, {
        totalPurchaseAmount: totalAmount,
        firstTradeDate: firstTradeDate || undefined,
        lastTradeDate: lastTradeDate || undefined,
        updatedAt: new Date().toISOString()
      } as any);
      updatedCount++;
    }
    await db.awaitPendingWrites();
    refreshAllData();
    return { updatedCount, totalAmount: grandTotal };
  };

  // 월 1회 당사자산 감가상각 결산 마감 실행 (월말 의도적 실행)
  const executeMonthlyDepreciation = async (depreciationYm: string, note?: string) => {
    const existing = db.depreciationLogs.find(l => l.depreciationYm === depreciationYm);
    if (existing) {
      throw new Error(`이미 [${depreciationYm}] 연월의 감가상각 결산 마감이 완료되었습니다. (마감 처리일시: ${existing.executedAt.substring(0, 10)})`);
    }

    const ownedAssets = db.assets.filter(a => a.ownerType === 'OWNED');
    let totalDepnSum = 0;
    let updatedCount = 0;
    const nowIso = new Date().toISOString();

    // 마감 연월의 말일 시점 Date 생성 (예: '2026-08' -> 2026년 8월 31일 23:59:59)
    const [ymYear, ymMonth] = depreciationYm.split('-').map(Number);
    const closingDate = new Date(ymYear, ymMonth, 0, 23, 59, 59, 999); // 해당 월의 마지막 날

    for (const asset of ownedAssets) {
      const cost = asset.acquisitionPrice || 0;
      if (cost <= 0 || !asset.acquisitionDate || !asset.depreciationMonths || asset.depreciationMonths <= 0) {
        continue;
      }

      // 1. 취득일자 검증: 마감 연월 말일보다 미래에 취득된 자산은 당월 상각 대상 제외
      const acqDate = new Date(asset.acquisitionDate);
      if (isNaN(acqDate.getTime()) || acqDate > closingDate) {
        continue;
      }

      // 2. 매각 여부 및 매각일자 검증: 매각 상태이거나 매각일이 마감 연월 이전/당월인 경우 상각 정지 처리
      if (asset.status === 'SOLD' || asset.disposalDate) {
        const dispDateStr = asset.disposalDate ? asset.disposalDate.substring(0, 7) : '';
        // 이미 마감 연월 이전이나 당월 이전에 매각된 자산은 감가상각 발생 중단
        if (dispDateStr && dispDateStr < depreciationYm) {
          continue;
        }
      }

      const residualRate = asset.residualValueRate ?? 0;
      const residualValue = Math.round(cost * (residualRate / 100));
      const depreciableAmount = cost - residualValue;
      if (depreciableAmount <= 0) continue;

      const monthlyDepn = depreciableAmount / asset.depreciationMonths;
      if (monthlyDepn <= 0) continue;

      // 3. 취득일(acqDate)부터 마감연월 말일(closingDate)까지의 경과 개월수 정밀 산출
      let yearsDiff = closingDate.getFullYear() - acqDate.getFullYear();
      let monthsDiff = closingDate.getMonth() - acqDate.getMonth();
      let totalElapsedMonths = yearsDiff * 12 + monthsDiff + 1; // 취득당월 포함

      if (totalElapsedMonths < 1) totalElapsedMonths = 1;

      // 매각 자산은 매각 시점까지의 경과월수로 캡 제한
      if ((asset.status === 'SOLD' || asset.disposalDate) && asset.disposalDate) {
        const dispDate = new Date(asset.disposalDate);
        if (!isNaN(dispDate.getTime()) && dispDate <= closingDate) {
          let dispYears = dispDate.getFullYear() - acqDate.getFullYear();
          let dispMonths = dispDate.getMonth() - acqDate.getMonth();
          totalElapsedMonths = Math.max(1, dispYears * 12 + dispMonths + 1);
        }
      }

      // 내용월수 캡 제한
      const effectiveElapsed = Math.min(totalElapsedMonths, asset.depreciationMonths);

      // 이번 마감 연월 시점의 목표 누적상각액 (IFRS 정액법 정밀 산출)
      const targetAccum = Math.min(depreciableAmount, Math.round(monthlyDepn * effectiveElapsed));

      const currentAccum = asset.accumDepreciation || 0;

      // 당월 반영할 감가상각비 = 목표 누적상각액 - 기존 누적상각액
      const actualDepn = Math.max(0, targetAccum - currentAccum);

      if (actualDepn <= 0 && currentAccum >= targetAccum) continue;

      const newAccum = Math.min(depreciableAmount, currentAccum + actualDepn);
      const newBookValue = Math.max(residualValue, cost - newAccum);

      db.updateRow<Asset>('assets', asset.id, {
        accumDepreciation: newAccum,
        bookValue: newBookValue,
        updatedAt: nowIso
      });

      totalDepnSum += actualDepn;
      updatedCount++;
    }

    db.insertRow<DepreciationLog>('depreciationLogs', {
      depreciationYm,
      executedAt: nowIso,
      executedBy: currentUser?.name || currentUser?.id,
      targetAssetCount: updatedCount,
      totalDepreciationAmount: totalDepnSum,
      note: note || `[${depreciationYm}] 월말 당사자산 감가상각 결산 마감 완료`,
      createdAt: nowIso,
      updatedAt: nowIso
    });

    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error('executeMonthlyDepreciation sync error:', err);
    }

    refreshAllData();
    return { count: updatedCount, totalAmount: totalDepnSum };
  };

  // ─────────────────────────────────────────────────────────
  // 월말 매입 정산 관련 Mutators
  // ─────────────────────────────────────────────────────────

  /** 당월 운송료 + 소모품 매입 + 임차자산 임차료 + 외주 정비비 자동 집계 → PurchaseSettlement 생성 */
  const generateMonthlyPurchaseSettlements = async (ym: string): Promise<{ transport: number; consumable: number; lease: number; repair: number }> => {
    const nowIso = new Date().toISOString();
    let transportCount = 0;
    let consumableCount = 0;
    let leaseCount = 0;

    // ① 운송료 집계 — 당월 DELIVERED 배차 중 미정산 건
    const deliveriesOfMonth = db.deliveries.filter(d => {
      const dateStr = d.unloadingDate || d.scheduledDate || d.requestDate;
      return dateStr?.startsWith(ym) &&
        d.status === 'DELIVERED' &&
        d.reconciliationStatus !== 'PAID' &&
        (d.deliveryCostConfirmed || 0) > 0;
    });

    // 운송사별 그루핑
    const transportGroups = new Map<string, typeof deliveriesOfMonth>();
    deliveriesOfMonth.forEach(d => {
      const key = d.transportCompany || '미지정 운송사';
      if (!transportGroups.has(key)) transportGroups.set(key, []);
      transportGroups.get(key)!.push(d);
    });

    for (const [vendorName, items] of transportGroups.entries()) {
      // 이미 동일 정산월+운송사 정산건이 있으면 스킵
      const exists = db.purchaseSettlements.find(p => p.settlementYm === ym && p.settlementType === 'TRANSPORT' && p.vendorName === vendorName);
      if (exists) continue;

      const totalAmount = items.reduce((sum, d) => sum + (d.deliveryCostConfirmed || d.deliveryCost || 0), 0);
      const settlement = db.insertRow<PurchaseSettlement>('purchaseSettlements', {
        settlementYm: ym,
        settlementType: 'TRANSPORT',
        vendorName,
        totalAmount,
        paidAmount: 0,
        status: 'PENDING',
        createdAt: nowIso,
        updatedAt: nowIso
      });

      items.forEach(d => {
        db.insertRow<PurchaseSettlementItem>('purchaseSettlementItems', {
          settlementId: settlement.id,
          sourceType: 'DELIVERY',
          sourceId: d.id,
          itemDescription: `배차 ${d.id} / ${d.dispatchCategory || d.type} (${d.unloadingDate || d.scheduledDate || d.requestDate})`,
          quantity: 1,
          unitPrice: d.deliveryCostConfirmed || d.deliveryCost || 0,
          amount: d.deliveryCostConfirmed || d.deliveryCost || 0,
          evidenceFileUrl: d.statementFileUrl,
          createdAt: nowIso
        });
      });
      transportCount++;
    }

    // ② 소모품 매입 집계 — 당월 COMPLETED / 입고 완료 구매신청 중 미정산 건
    const existingConsumableSettlementSourceIds = new Set(
      db.purchaseSettlementItems
        .filter(i => i.sourceType === 'CONSUMABLE_PURCHASE')
        .map(i => i.sourceId)
    );

    const purchasesOfMonth = db.consumablePurchases.filter(p => {
      if (existingConsumableSettlementSourceIds.has(p.id)) return false;
      const isFinished = p.status === 'COMPLETED' || p.receivedQty > 0;
      if (!isFinished) return false;
      const rawDate = p.completedDate || p.requestDate || p.createdAt || '';
      const normDate = rawDate.replace(/\./g, '-');
      return normDate.startsWith(ym);
    });

    // 판매처별 그루핑
    const consumableGroups = new Map<string, typeof purchasesOfMonth>();
    purchasesOfMonth.forEach(p => {
      const key = p.sellerName || '미지정 판매처';
      if (!consumableGroups.has(key)) consumableGroups.set(key, []);
      consumableGroups.get(key)!.push(p);
    });

    for (const [vendorName, items] of consumableGroups.entries()) {
      const groupTotalAmount = items.reduce((sum, p) => sum + (p.requestedQty * p.unitPrice), 0);

      let settlement = db.purchaseSettlements.find(p => p.settlementYm === ym && p.settlementType === 'CONSUMABLE' && p.vendorName === vendorName);
      if (!settlement) {
        settlement = db.insertRow<PurchaseSettlement>('purchaseSettlements', {
          settlementYm: ym,
          settlementType: 'CONSUMABLE',
          vendorName,
          totalAmount: groupTotalAmount,
          paidAmount: 0,
          status: 'PENDING',
          createdAt: nowIso,
          updatedAt: nowIso
        });
      } else {
        db.updateRow<PurchaseSettlement>('purchaseSettlements', settlement.id, {
          totalAmount: settlement.totalAmount + groupTotalAmount,
          updatedAt: nowIso
        });
      }

      items.forEach(p => {
        db.insertRow<PurchaseSettlementItem>('purchaseSettlementItems', {
          settlementId: settlement.id,
          sourceType: 'CONSUMABLE_PURCHASE',
          sourceId: p.id,
          itemDescription: `${p.modelName} × ${p.requestedQty}개 (${p.completedDate || p.requestDate})`,
          quantity: p.requestedQty,
          unitPrice: p.unitPrice,
          amount: p.requestedQty * p.unitPrice,
          evidenceFileUrl: p.statementFileUrl,
          createdAt: nowIso
        });
      });
      consumableCount++;
    }

    // ③ 임차자산(ownerType === 'RENTED') 임차료 집계 및 자동 정산 생성
    const rentedAssetsOfMonth = db.assets.filter(a => {
      if (a.ownerType !== 'RENTED' || !a.monthlyRentFee || a.monthlyRentFee <= 0) return false;
      const vId = a.vendorId;
      if (!vId) return false;
      const start = a.rentStart ? a.rentStart.slice(0, 7) : '';
      const end = a.actualRentReturnDate ? a.actualRentReturnDate.slice(0, 7) : (a.rentEnd ? a.rentEnd.slice(0, 7) : '9999-12');
      return (!start || start <= ym) && ym <= end;
    });

    const rentedByVendor: Record<string, Asset[]> = {};
    rentedAssetsOfMonth.forEach(a => {
      const vId = a.vendorId!;
      if (!rentedByVendor[vId]) rentedByVendor[vId] = [];
      rentedByVendor[vId].push(a);
    });

    for (const [vendorId, aList] of Object.entries(rentedByVendor)) {
      const existing = db.purchaseSettlements.find(p => p.vendorId === vendorId && p.settlementYm === ym && p.settlementType === 'EQUIPMENT_LEASE');
      if (existing) continue;

      const vendor = db.vendors.find(v => v.id === vendorId);
      const vendorName = vendor?.name || aList[0]?.renter || '장비 임차처';
      const totalAmount = aList.reduce((sum, a) => sum + (a.monthlyRentFee || 0), 0);
      const settlementId = db.generateNextId('purchaseSettlements', db.purchaseSettlements);

      db.insertRow<PurchaseSettlement>('purchaseSettlements', {
        id: settlementId,
        settlementYm: ym,
        vendorId,
        vendorName,
        settlementType: 'EQUIPMENT_LEASE',
        totalAmount,
        paidAmount: 0,
        status: 'PENDING',
        itemCount: aList.length,
        createdAt: nowIso,
        updatedAt: nowIso
      });

      aList.forEach(a => {
        db.insertRow<PurchaseSettlementItem>('purchaseSettlementItems', {
          settlementId,
          sourceType: 'EQUIPMENT_LEASE',
          sourceId: a.id,
          itemDescription: `장비임차: ${a.assetNo} (${a.modelName})`,
          quantity: 1,
          unitPrice: a.monthlyRentFee || 0,
          amount: a.monthlyRentFee || 0,
          createdAt: nowIso
        });
      });
    }

    const leaseSettlementsOfMonth = db.purchaseSettlements.filter(p => 
      p.settlementYm === ym && 
      (p.settlementType === 'EQUIPMENT_LEASE')
    );
    leaseCount = leaseSettlementsOfMonth.length;

    // ④ [신규 추가] 외주 정비비 집계 — 정비수리(Repairs)에서 repairType === 'EXTERNAL'이고 status === 'COMPLETED'인 외주 정비 건 수집
    let repairCount = 0;
    const completedExternalRepairs = db.repairs.filter(r => {
      if (r.repairType !== 'EXTERNAL' || r.status !== 'COMPLETED' || !r.vendorId) return false;
      const rDate = r.completedDate || r.requestDate || r.repairDate;
      return rDate && rDate.startsWith(ym);
    });

    const repairsByVendor: Record<string, Repair[]> = {};
    completedExternalRepairs.forEach(r => {
      if (!repairsByVendor[r.vendorId!]) repairsByVendor[r.vendorId!] = [];
      repairsByVendor[r.vendorId!].push(r);
    });

    for (const [vendorId, rList] of Object.entries(repairsByVendor)) {
      const vendor = db.vendors.find(v => v.id === vendorId);
      const vendorName = vendor?.name || '외주 정비업체';
      const existing = db.purchaseSettlements.find(p => p.vendorId === vendorId && p.settlementYm === ym && p.settlementType === 'EXTERNAL_REPAIR');
      if (existing) continue;

      const totalAmount = rList.reduce((sum, r) => sum + (r.totalCost || 0), 0);
      const settlementId = db.generateNextId('purchaseSettlements', db.purchaseSettlements);

      db.insertRow<PurchaseSettlement>('purchaseSettlements', {
        id: settlementId,
        settlementYm: ym,
        vendorId,
        vendorName,
        settlementType: 'EXTERNAL_REPAIR',
        totalAmount,
        paidAmount: 0,
        status: 'PENDING',
        itemCount: rList.length,
        createdAt: nowIso
      });

      rList.forEach(r => {
        const asset = db.assets.find(a => a.id === r.assetId);
        db.insertRow<PurchaseSettlementItem>('purchaseSettlementItems', {
          settlementId,
          sourceType: 'REPAIR' as any,
          sourceId: r.id,
          itemDescription: `외주 정비 ${asset?.assetNo || '자산'} ${r.details.slice(0, 30)}`,
          quantity: 1,
          unitPrice: r.totalCost || 0,
          amount: r.totalCost || 0,
          evidenceFileUrl: r.estimateFileUrl || r.faultImageUrl,
          createdAt: nowIso
        });

        // repair에 purchaseBillId 연결
        db.updateRow<Repair>('repairs', r.id, {
          purchaseBillId: settlementId,
          updatedAt: nowIso
        });
      });
      repairCount++;
    }

    try {
      await db.awaitPendingWrites();
    } catch (err: any) {
      console.error('generateMonthlyPurchaseSettlements error:', err);
    }

    refreshAllData();
    return { transport: transportCount, consumable: consumableCount, lease: leaseCount, repair: repairCount };
  };

  const confirmPurchaseSettlement = async (id: string): Promise<void> => {
    const settlement = db.purchaseSettlements.find(p => p.id === id);
    db.updateRow<PurchaseSettlement>('purchaseSettlements', id, {
      status: 'CONFIRMED',
      confirmedAt: new Date().toISOString(),
      confirmedBy: currentUser?.name || '시스템'
    });
    if (settlement) {
      triggerVendorPurchaseMetric(
        settlement.vendorId || settlement.vendorName || '',
        settlement.totalAmount || 0,
        settlement.paymentDate || (settlement.settlementYm ? `${settlement.settlementYm}-01` : undefined)
      );
    }
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const recordPurchaseSettlementPayment = async (
    id: string,
    data: { paidAmount: number; paymentDate: string; paymentMethod: string; bankAccount?: string; bankTransactionId?: string; memo?: string }
  ): Promise<void> => {
    const settlement = db.purchaseSettlements.find(p => p.id === id);
    if (!settlement) return;
    const newPaidAmount = (settlement.paidAmount || 0) + data.paidAmount;
    const newStatus: PurchaseSettlementStatus = newPaidAmount >= settlement.totalAmount ? 'PAID' : 'CONFIRMED';
    db.updateRow<PurchaseSettlement>('purchaseSettlements', id, {
      paidAmount: newPaidAmount,
      status: newStatus,
      paymentDate: data.paymentDate,
      paymentMethod: data.paymentMethod,
      bankAccount: data.bankAccount,
      bankTransactionId: data.bankTransactionId,
      memo: data.memo
    });

    // SettlementPaymentLog 지급 이력 레코드 1:N 보관 (Audit Trail)
    const logId = `SPL-${Date.now()}`;
    const logs = db.settlementPaymentLogs;
    logs.push({
      id: logId,
      settlementId: id,
      bankTransactionId: data.bankTransactionId,
      paidAmount: data.paidAmount,
      paymentDate: data.paymentDate,
      paymentMethod: data.paymentMethod,
      bankAccount: data.bankAccount,
      memo: data.memo,
      createdAt: new Date().toISOString()
    });
    db.settlementPaymentLogs = logs;

    // 연결된 배차 건 상태 PAID 연동
    if (newStatus === 'PAID' && settlement.settlementType === 'TRANSPORT') {
      const items = db.purchaseSettlementItems.filter(i => i.settlementId === id && i.sourceType === 'DELIVERY');
      items.forEach(item => {
        db.updateRow<Delivery>('deliveries', item.sourceId, {
          reconciliationStatus: 'PAID',
          paymentCompletedAt: new Date().toISOString()
        });
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
  };

  const savePurchaseSettlement = async (settlement: Partial<PurchaseSettlement>): Promise<void> => {
    if (!settlement.id) return;
    db.updateRow<PurchaseSettlement>('purchaseSettlements', settlement.id, {
      ...settlement,
      updatedAt: new Date().toISOString()
    });
    await db.awaitPendingWrites();
    refreshAllData();
  };

  // ── 월말 감가상각 결산 취소 (롤백) ──
  const cancelMonthlyDepreciation = async (depreciationYm: string): Promise<void> => {
    try {
      const log = db.depreciationLogs.find(l => l.depreciationYm === depreciationYm);
      if (!log) {
        throw new Error(`[${depreciationYm}] 연월의 감가상각 결산 이력이 존재하지 않습니다.`);
      }

      // 1. 해당 연월의 DepreciationLog 삭제
      db.deleteRow('depreciationLogs', log.id);

      // 2. 이전 연월(1개월 전)의 말일 시점으로 각 자산의 감가상각 재계산 및 롤백
      const [year, month] = depreciationYm.split('-').map(Number);
      const prevClosingDate = new Date(year, month - 1, 0, 23, 59, 59, 999);

      db.assets.forEach(asset => {
        if (asset.ownerType === 'OWNED') {
          const depnInfo = calculateAssetDepreciation(asset, prevClosingDate);
          db.updateRow<Asset>('assets', asset.id, {
            accumDepreciation: depnInfo.accumDepreciation,
            bookValue: depnInfo.bookValue,
            updatedAt: new Date().toISOString()
          });
        }
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 감가상각 결산 취소 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  // ── 대사 완료 배차 → 월말 매입 정산 자동 집계 ──
  const convertReconciledDeliveriesToSettlement = async (settlementYm: string, transportCompanyId?: string): Promise<number> => {
    try {
      const targetDeliveries = db.deliveries.filter(d => {
        const dDate = d.loadingDate || d.scheduledDate || d.requestDate || d.createdAt.split('T')[0];
        const matchYm = dDate.startsWith(settlementYm);
        const matchStatus = d.reconciliationStatus === 'RECONCILED' || d.reconciliationStatus === 'MATCHED';
        const matchComp = !transportCompanyId || d.transportCompany === transportCompanyId;
        return matchYm && matchStatus;
      });

      if (targetDeliveries.length === 0) return 0;

      // 운송사별 그룹핑
      const compGroups = new Map<string, Delivery[]>();
      targetDeliveries.forEach(d => {
        const comp = d.transportCompany || '기타 운송사';
        if (!compGroups.has(comp)) compGroups.set(comp, []);
        compGroups.get(comp)!.push(d);
      });

      let totalConverted = 0;
      for (const [compName, dList] of compGroups.entries()) {
        const compObj = db.transportCompanies.find(c => c.name === compName);
        const settlementId = `PST-TR-${settlementYm.replace('-', '')}-${(compObj?.id || compName).slice(-6)}`;
        
        let existingSettlement = db.purchaseSettlements.find(s => s.id === settlementId);
        const totalSum = dList.reduce((acc, d) => acc + (d.deliveryCostConfirmed || d.deliveryCost || 0), 0);

        if (!existingSettlement) {
          db.insertRow<PurchaseSettlement>('purchaseSettlements', {
            id: settlementId,
            settlementYm,
            settlementType: 'TRANSPORT',
            vendorId: compObj?.id,
            vendorName: compName,
            totalAmount: totalSum,
            paidAmount: 0,
            status: 'PENDING',
            bankAccount: compObj?.bankAccount ? `${compObj.bankName || ''} ${compObj.bankAccount} (${compObj.bankHolder || ''})` : undefined,
            itemCount: dList.length,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        } else {
          db.updateRow<PurchaseSettlement>('purchaseSettlements', settlementId, {
            totalAmount: existingSettlement.totalAmount + totalSum,
            itemCount: (existingSettlement.itemCount || 0) + dList.length,
            updatedAt: new Date().toISOString()
          });
        }

        // 아이템 삽입 및 배차 상태 갱신
        dList.forEach(d => {
          const cost = d.deliveryCostConfirmed || d.deliveryCost || 0;
          db.insertRow<PurchaseSettlementItem>('purchaseSettlementItems', {
            settlementId,
            sourceType: 'DELIVERY',
            sourceId: d.id,
            itemDescription: `[배차 운반비] ${d.originAddress || '상차지'} ➔ ${d.destinationAddress || '하차지'} (${d.vehicleType || '차량'})`,
            quantity: 1,
            unitPrice: cost,
            amount: cost,
            createdAt: new Date().toISOString()
          });

          db.updateRow<Delivery>('deliveries', d.id, {
            reconciliationStatus: 'PAYMENT_REQUESTED',
            updatedAt: new Date().toISOString()
          });
          totalConverted++;
        });
      }

      await db.awaitPendingWrites();
      refreshAllData();
      return totalConverted;
    } catch (err: any) {
      showErrorModal(`⚠️ 매입 정산 이관 오류:\n${err?.message || err}`);
      throw err;
    }
  };

  // ── 고객 과실 수리비 청구서 연동 ──
  const linkRepairToBilling = async (repairId: string, billingId: string): Promise<void> => {
    try {
      db.updateRow<Repair>('repairs', repairId, {
        billingId,
        updatedAt: new Date().toISOString()
      });

      // 🟢 유상 수리비 청구 ToDo 자동 상계
      await clearHandoverTasks({
        entityType: 'REPAIR',
        entityId: repairId,
        category: 'BILLABLE_REPAIR_BILLING',
        completedByUserId: currentUser?.id,
        completedByName: currentUser?.name,
        completionAction: `LINKED_TO_BILLING_${billingId}`
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 수리비 청구 연동 실패:\n${err?.message || err}`);
    }
  };

  const unlinkRepairFromBilling = async (repairId: string): Promise<void> => {
    try {
      db.updateRow<Repair>('repairs', repairId, {
        billingId: undefined,
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 수리비 청구 연동 해제 실패:\n${err?.message || err}`);
    }
  };

  // ── 고객 과실 수리비 영업 청구 면제 처리 ──
  const waiveRepairBilling = async (repairId: string, waivedAmount: number, waivedReason: string, waivedBy: string): Promise<void> => {
    try {
      const now = new Date().toISOString();
      db.updateRow<Repair>('repairs', repairId, {
        isWaived: true,
        waivedAmount,
        waivedReason,
        waivedBy,
        waivedAt: now,
        updatedAt: now
      });

      // 🟢 유상 수리비 청구 ToDo 자동 상계 (영업 면제 완료)
      await clearHandoverTasks({
        entityType: 'REPAIR',
        entityId: repairId,
        category: 'BILLABLE_REPAIR_BILLING',
        completedByUserId: currentUser?.id,
        completedByName: currentUser?.name,
        completionAction: `WAIVED_BY_SALES_${waivedBy}`
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 수리비 영업 면제 처리 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const cancelRepairWaiver = async (repairId: string): Promise<void> => {
    try {
      const now = new Date().toISOString();
      db.updateRow<Repair>('repairs', repairId, {
        isWaived: false,
        waivedAmount: 0,
        waivedReason: undefined,
        waivedBy: undefined,
        waivedAt: undefined,
        updatedAt: now
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 수리비 영업 면제 취소 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  // ── 고객 부담 운송료 청구서 연동 및 영업 면제 ──
  const linkDeliveryToBilling = async (deliveryId: string, billingId: string): Promise<void> => {
    try {
      db.updateRow<Delivery>('deliveries', deliveryId, {
        billingId,
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 운송료 청구 연동 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const unlinkDeliveryFromBilling = async (deliveryId: string): Promise<void> => {
    try {
      db.updateRow<Delivery>('deliveries', deliveryId, {
        billingId: undefined,
        updatedAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 운송료 청구 연동 해제 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const waiveDeliveryBilling = async (deliveryId: string, waivedAmount: number, waivedReason: string, waivedBy: string): Promise<void> => {
    try {
      const now = new Date().toISOString();
      db.updateRow<Delivery>('deliveries', deliveryId, {
        isWaived: true,
        waivedAmount,
        waivedReason,
        waivedBy,
        waivedAt: now,
        updatedAt: now
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 운송료 영업 면제 처리 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const cancelDeliveryWaiver = async (deliveryId: string): Promise<void> => {
    try {
      const now = new Date().toISOString();
      db.updateRow<Delivery>('deliveries', deliveryId, {
        isWaived: false,
        waivedAmount: 0,
        waivedReason: undefined,
        waivedBy: undefined,
        waivedAt: undefined,
        updatedAt: now
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 운송료 영업 면제 취소 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  // ── 선수금 (예치금) 관리 ──
  const chargePrepaidBalance = async (customerId: string, amount: number, memo?: string): Promise<void> => {
    try {
      const customer = db.customers.find(c => c.id === customerId);
      if (!customer) throw new Error('고객사를 찾을 수 없습니다.');
      if (amount <= 0) throw new Error('유효한 금액을 입력하십시오.');

      const nextBal = (customer.prepaidBalance || 0) + amount;
      db.updateRow<Customer>('customers', customerId, {
        prepaidBalance: nextBal
      });

      db.insertRow<PrepaidTransaction>('prepaidTransactions', {
        customerId,
        type: 'CHARGE',
        amount,
        balanceAfter: nextBal,
        memo: memo || '선수금(예치금) 충전/입금',
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 선수금 충전 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const applyPrepaidBalanceForBilling = async (billingId: string, amount: number, memo?: string): Promise<void> => {
    try {
      if (!amount || amount <= 0) {
        throw new Error('상계할 금액은 1원 이상이어야 합니다.');
      }
      const billing = db.billings.find(b => b.id === billingId);
      if (!billing) throw new Error('청구서를 찾을 수 없습니다.');
      const customer = db.customers.find(c => c.id === billing.customerId);
      if (!customer) throw new Error('고객사를 찾을 수 없습니다.');

      const currentBal = customer.prepaidBalance || 0;
      if (currentBal < amount) {
        throw new Error(`선수금 잔액이 부족합니다. (현재 잔액: ₩${currentBal.toLocaleString()}원, 요청액: ₩${amount.toLocaleString()}원)`);
      }

      const bSup = billing.totalAmount || 0;
      const bGrand = bSup + Math.round(bSup * 0.1);
      const unpaid = Math.max(0, bGrand - (billing.paidAmount || 0));
      if (amount > unpaid) {
        throw new Error(`청구서 미수금(₩${unpaid.toLocaleString()}원)을 초과하여 상계할 수 없습니다.`);
      }

      // 1. 고객 선수금 잔액 차감
      const nextBal = currentBal - amount;
      db.updateRow<Customer>('customers', customer.id, {
        prepaidBalance: nextBal
      });

      // 2. 수납 (Payment) 레코드 생성
      const paymentId = `pay-prepaid-${Date.now()}`;
      db.insertRow<Payment>('payments', {
        id: paymentId,
        billingId,
        paymentDate: new Date().toISOString().split('T')[0],
        amount,
        method: 'PREPAID',
        memo: memo || `선수금(예치금) 상계 수납 (잔여 선수금: ₩${nextBal.toLocaleString()}원)`,
        createdAt: new Date().toISOString()
      });

      // 3. 청구서 수납액 및 상태 갱신 (VAT 포함 총액 기준)
      const newPaid = billing.paidAmount + amount;
      const newStatus = newPaid >= bGrand ? 'PAID' : 'PARTIAL';
      db.updateRow<Billing>('billings', billingId, {
        paidAmount: newPaid,
        status: newStatus,
        updatedAt: new Date().toISOString()
      });

      // 4. 선수금 사용 이력 기록
      db.insertRow<PrepaidTransaction>('prepaidTransactions', {
        customerId: customer.id,
        type: 'USE_FOR_BILLING',
        amount,
        balanceAfter: nextBal,
        billingId,
        paymentId,
        memo: memo || `청구서(${billing.billingYm}) 선수금 상계 수납`,
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 선수금 상계 수납 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const refundPrepaidBalance = async (customerId: string, amount: number, memo?: string): Promise<void> => {
    try {
      if (!amount || amount <= 0) {
        throw new Error('환불할 금액은 1원 이상이어야 합니다.');
      }
      const customer = db.customers.find(c => c.id === customerId);
      if (!customer) throw new Error('고객사를 찾을 수 없습니다.');
      const currentBal = customer.prepaidBalance || 0;
      if (currentBal < amount) {
        throw new Error(`환불 요청 금액이 선수금 잔액을 초과합니다. (잔액: ₩${currentBal.toLocaleString()}원)`);
      }

      const nextBal = currentBal - amount;
      db.updateRow<Customer>('customers', customerId, {
        prepaidBalance: nextBal
      });

      db.insertRow<PrepaidTransaction>('prepaidTransactions', {
        customerId,
        type: 'REFUND',
        amount,
        balanceAfter: nextBal,
        memo: memo || '선수금(예치금) 환불 처리',
        createdAt: new Date().toISOString()
      });

      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 선수금 환불 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  // ── 연체 조치 및 입금 약속 관리 ──
  const saveDelinquencyAction = async (action: Omit<DelinquencyActionLog, 'id' | 'createdAt'>): Promise<void> => {
    try {
      db.insertRow<DelinquencyActionLog>('delinquencyActionLogs', {
        ...action,
        createdAt: new Date().toISOString()
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 연체 조치사항 저장 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const updateDelinquencyActionPromise = async (actionId: string, status: 'PENDING' | 'KEPT' | 'BROKEN'): Promise<void> => {
    try {
      db.updateRow<DelinquencyActionLog>('delinquencyActionLogs', actionId, {
        promiseStatus: status
      });
      await db.awaitPendingWrites();
      refreshAllData();
    } catch (err: any) {
      showErrorModal(`⚠️ 입금 약속 상태 변경 실패:\n${err?.message || err}`);
      throw err;
    }
  };

  const saveLegalNoticeLog = async (log: Omit<LegalNoticeLog, 'id' | 'createdAt'>): Promise<LegalNoticeLog> => {
    const newLog = db.insertRow<LegalNoticeLog>('legalNoticeLogs', {
      ...log,
      createdAt: new Date().toISOString()
    }) as LegalNoticeLog;

    await db.awaitPendingWrites();
    refreshAllData();
    return newLog;
  };

  const saveLegalNoticeTemplate = async (tpl: Omit<LegalNoticeTemplate, 'id' | 'updatedAt'> & { id?: string }): Promise<void> => {
    const existing = db.legalNoticeTemplates[0];
    if (existing) {
      db.updateRow<LegalNoticeTemplate>('legalNoticeTemplates', existing.id, {
        ...tpl,
        updatedAt: new Date().toISOString()
      });
    } else {
      db.insertRow<LegalNoticeTemplate>('legalNoticeTemplates', {
        ...tpl,
        updatedAt: new Date().toISOString()
      });
    }

    refreshAllData();
    if (db.isSupabaseConnected() && db.pendingWrites.length > 0) {
      try {
        await db.pendingWrites[db.pendingWrites.length - 1];
      } catch (err) {
        console.error('Supabase write error:', err);
      }
    }
  };

  // ============================================================
  // 법인 차량 및 차량운행일지/주유 영수증 Mutators (Corporate Fleet & Logs)
  // ============================================================

  const registerCorporateVehicle = async (vehicleData: Omit<CorporateVehicle, 'id' | 'createdAt' | 'updatedAt'>): Promise<CorporateVehicle> => {
    const now = new Date().toISOString();
    const newVehicle = db.insertRow<CorporateVehicle>('corporateVehicles', {
      ...vehicleData,
      createdAt: now,
      updatedAt: now
    }) as CorporateVehicle;
    await db.awaitPendingWrites();
    refreshAllData();
    return newVehicle;
  };

  const updateCorporateVehicle = async (id: string, updates: Partial<CorporateVehicle>): Promise<void> => {
    db.updateRow<CorporateVehicle>('corporateVehicles', id, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const deleteCorporateVehicle = async (id: string): Promise<void> => {
    // ✅ 고아 레코드 방지: 차량 삭제 시 연관 운행일지, 주유 기록 cascade 삭제
    const linkedOpLogs = db.vehicleOperationLogs.filter(l => l.vehicleId === id);
    linkedOpLogs.forEach(l => db.deleteRow('vehicleOperationLogs', l.id));
    const linkedFuelLogs = db.vehicleFuelLogs.filter(l => l.vehicleId === id);
    linkedFuelLogs.forEach(l => db.deleteRow('vehicleFuelLogs', l.id));
    db.deleteRow('corporateVehicles', id);
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const registerVehicleOperationLog = async (logData: Omit<VehicleOperationLog, 'id' | 'createdAt' | 'updatedAt'>): Promise<VehicleOperationLog> => {
    const now = new Date().toISOString();
    const driveDistance = Math.max(0, (logData.arrivalMileage || 0) - (logData.departureMileage || 0));
    const newLog = db.insertRow<VehicleOperationLog>('vehicleOperationLogs', {
      ...logData,
      driveDistance: logData.driveDistance !== undefined ? logData.driveDistance : driveDistance,
      createdAt: now,
      updatedAt: now
    }) as VehicleOperationLog;

    // 차량의 현재 누적 주행거리 자동 업데이트 (도착 거리가 더 큰 경우)
    const veh = db.corporateVehicles.find(v => v.id === logData.vehicleId);
    if (veh && logData.arrivalMileage > veh.currentMileage) {
      db.updateRow<CorporateVehicle>('corporateVehicles', veh.id, {
        currentMileage: logData.arrivalMileage,
        updatedAt: now
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
    return newLog;
  };

  const updateVehicleOperationLog = async (id: string, updates: Partial<VehicleOperationLog>): Promise<void> => {
    db.updateRow<VehicleOperationLog>('vehicleOperationLogs', id, {
      ...updates,
      updatedAt: new Date().toISOString()
    });
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const deleteVehicleOperationLog = async (id: string): Promise<void> => {
    db.deleteRow('vehicleOperationLogs', id);
    await db.awaitPendingWrites();
    refreshAllData();
  };

  const registerVehicleFuelLog = async (fuelData: Omit<VehicleFuelLog, 'id' | 'createdAt' | 'updatedAt'>): Promise<VehicleFuelLog> => {
    const now = new Date().toISOString();
    const fuelUnitPrice = fuelData.fuelUnitPrice || (fuelData.fuelVolume > 0 ? Math.round(fuelData.fuelAmount / fuelData.fuelVolume) : 0);
    
    // 직전 주유 대비 연비 자동 계산 (동일 차량의 직전 주유 기록 검색)
    const pastFuelLogs = db.vehicleFuelLogs
      .filter(f => f.vehicleId === fuelData.vehicleId && f.currentMileage < fuelData.currentMileage)
      .sort((a, b) => b.currentMileage - a.currentMileage);
    let calculatedEfficiency: number | undefined = undefined;
    if (pastFuelLogs.length > 0 && fuelData.fuelVolume > 0) {
      const distanceDelta = fuelData.currentMileage - pastFuelLogs[0].currentMileage;
      if (distanceDelta > 0) {
        calculatedEfficiency = Number((distanceDelta / fuelData.fuelVolume).toFixed(2));
      }
    }

    const newFuelLog = db.insertRow<VehicleFuelLog>('vehicleFuelLogs', {
      ...fuelData,
      fuelUnitPrice,
      fuelEfficiency: fuelData.fuelEfficiency || calculatedEfficiency,
      createdAt: now,
      updatedAt: now
    }) as VehicleFuelLog;

    // 차량의 현재 누적 주행거리 자동 업데이트
    const veh = db.corporateVehicles.find(v => v.id === fuelData.vehicleId);
    if (veh && fuelData.currentMileage > veh.currentMileage) {
      db.updateRow<CorporateVehicle>('corporateVehicles', veh.id, {
        currentMileage: fuelData.currentMileage,
        updatedAt: now
      });
    }

    await db.awaitPendingWrites();
    refreshAllData();
    return newFuelLog;
  };

  const deleteVehicleFuelLog = async (id: string): Promise<void> => {
    db.deleteRow('vehicleFuelLogs', id);
    await db.awaitPendingWrites();
    refreshAllData();
  };

  // 分散 인쇄 큐 & 스테이션 관리 액션
  const enqueuePrintJobAction = async (params: {
    stationId?: string;
    docType: 'DISPATCH_ORDER' | 'RETURN_ORDER';
    docNo?: string;
    title: string;
    documentHtml: string;
    requestedById?: string;
    requestedByName?: string;
  }): Promise<PrintQueueItem> => {
    const job = await serviceEnqueuePrintJob(params);
    refreshAllData();
    return job;
  };

  const registerPrintStationAction = async (station: {
    id?: string;
    stationName: string;
    localPrinterName: string;
    machineName?: string;
    docTypeDefault?: 'DISPATCH_ORDER' | 'RETURN_ORDER' | 'ALL';
    description?: string;
  }): Promise<PrintStation> => {
    const s = await serviceRegisterPrintStation(station);
    refreshAllData();
    return s;
  };

  const deletePrintStationAction = async (id: string): Promise<void> => {
    await serviceDeletePrintStation(id);
    refreshAllData();
  };

  const retryPrintJobAction = async (id: string): Promise<void> => {
    await serviceRetryPrintJob(id);
    refreshAllData();
  };

  const cancelPrintJobAction = async (id: string): Promise<void> => {
    await serviceCancelPrintJob(id);
    refreshAllData();
  };

  return (
    <AppContext.Provider value={{ receivables: db.receivables as any[], refreshReceivables: () => {}, 
      currentUser, theme, toggleTheme, login, logout, switchUser, hasPermission, showErrorModal,
      tenants, currentTenant, setCurrentTenantId, saveTenant,
      addTenantWorkplace, updateTenantWorkplace, deleteTenantWorkplace,
      addTenantYard, updateTenantYard, deleteTenantYard, setDefaultYard,
      users, permissions, customers, contacts, sites, products, assets, consumables, consumableLogs, consumablePurchases, mechanicConsumableStocks, contracts, contractAssets, contractHistory, deliveries, billings, billingDetails, payments, paymentDepositLinks, repairs, repairConsumables, transportCompanies, transportDrivers, transportNegotiations, subleaseNegotiations, todos,
      stocktakingAudits, stocktakingAuditItems, collectedParts,
      bankTransactions, bankMatchingRules, bankInitialBalances, assetInOutLogs, vendors, googleConfigs, cashFlowSnapshots, outboundInspections, depreciationLogs,
      purchaseSettlements, purchaseSettlementItems, settlementPaymentLogs: db.settlementPaymentLogs, externalLeases, inspectionChecklistItems,
      equipmentManuals, saveEquipmentManual, deleteEquipmentManual,
      standardOptions, saveStandardOption, deleteStandardOption,
      customRoles, rolePermissions, saveCustomRole, deleteCustomRole, saveRolePermissions, assignUserRole,
      annualLeaveQuotas, leaveUsages, overtimeRecords, payrollClosings, prepaidTransactions, delinquencyActionLogs, legalNoticeLogs, legalNoticeTemplates, saveLegalNoticeLog, saveLegalNoticeTemplate,
      corporateVehicles, vehicleOperationLogs, vehicleFuelLogs, registerCorporateVehicle, updateCorporateVehicle, deleteCorporateVehicle, registerVehicleOperationLog, updateVehicleOperationLog, deleteVehicleOperationLog, registerVehicleFuelLog, deleteVehicleFuelLog,
      refreshAllData, fullRefreshFromServer, executeMonthlyDepreciation, loadTablesForMenu, updatePermissions, saveUser, saveCustomer, saveContact, deleteContact, saveSite, deleteSite, saveProduct, saveAsset, updateGoogleConfig,
      saveCashFlowSnapshot, deleteCashFlowSnapshot, saveVendor, deleteVendor, recalculateAllVendorMetrics, saveBankInitialBalance, saveInspectionChecklistItem, deleteInspectionChecklistItem,
      updateAnnualLeaveQuota, addLeaveUsage, deleteLeaveUsage, addOvertimeRecord, deleteOvertimeRecord, setPayrollClosingStatus,
      acquireAsset, batchAcquireAssets, disposeAsset, executeAssetSale, registerRentedAsset, returnRentedAsset, createVendorClaimReceivable, changeAssetStatus, registerInboundAsset, cancelInboundAsset,
      purchaseConsumable, useConsumable, transferConsumableToMechanic, returnConsumableToHq, transferConsumableBetweenMechanics, addConsumable, updateConsumable, deleteConsumable,
      createStocktakingAudit, updateStocktakingItem, confirmStocktakingAudit, cancelStocktakingAudit, processCollectedPart,
      requestConsumablePurchase, acceptConsumablePurchase, completeConsumablePurchase, inboundConsumablePurchase, clearEvidenceFileUrls, updateEvidenceFileUrls,
      createContract, extendContract, shortenContract, succeedContract, exchangeAsset,
      assignAssetToContract, batchAssignAssetsToContract, unassignAssetFromContract, batchUnassignAssetsFromContract, exchangeOutboundAsset,
      saveSmartDispatch, saveSmartReturn,
      completeTodo, issueExecutiveDirective, resolveExecutiveDirective, cancelExecutiveDirective,
      generateBillingsForMonth, getDueContractsForBilling, generateDueBillings, generateBillingForSingleContract, regenerateBilling, approveBilling, cancelBilling, receivePayment, cancelPayment, cancelAllPaymentsForBilling, saveBankDeposit, deleteBankDeposit,
      addReceivable, generateStandaloneBillingForReceivable, linkReceivableToBilling,
      uploadBankTransactions, matchTransactionManual, batchAutoMatchTransactions, unmatchTransaction, saveMatchingRule, deleteMatchingRule,
      dispatchDelivery, settleDeliveryCost, completeDelivery, completeInboundDelivery,
      registerRepair, updateRepairStatus,
      // 현장 AS 관리 (단일 물리 테이블 repairs 뷰 제공)
      fieldAsTickets: repairs.filter(r => r.workCategory === 'FIELD_AS' || r.source === 'BAND_IMPORT' || r.source === 'SALES_REQUEST'),
      createFieldAsTicket,
      updateFieldAsTicketStatus,
      completeFieldAsTicket,
      createRevisitAsTicket,
      importBandAsHistory,
      logFieldAsTimelineEvent,
      saveTransportDataOnFly,
      generateMonthlyPurchaseSettlements, confirmPurchaseSettlement, recordPurchaseSettlementPayment, savePurchaseSettlement, convertReconciledDeliveriesToSettlement,
      cancelMonthlyDepreciation, linkRepairToBilling, unlinkRepairFromBilling,
      waiveRepairBilling, cancelRepairWaiver, linkDeliveryToBilling, unlinkDeliveryFromBilling, waiveDeliveryBilling, cancelDeliveryWaiver,
      chargePrepaidBalance, applyPrepaidBalanceForBilling, refundPrepaidBalance,
      saveDelinquencyAction, updateDelinquencyActionPromise,
      printStations,
      printQueue,
      enqueuePrintJob: enqueuePrintJobAction,
      registerPrintStation: registerPrintStationAction,
      deletePrintStation: deletePrintStationAction,
      retryPrintJob: retryPrintJobAction,
      cancelPrintJob: cancelPrintJobAction,
      activeTab,
      setActiveTab,
      navigationPayload,
      setNavigationPayload
    }}>
      {children}
      <ErrorModal
        isOpen={errorModal.isOpen}
        title={errorModal.title}
        message={errorModal.message}
        onClose={() => setErrorModal(prev => ({ ...prev, isOpen: false }))}
      />
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};
