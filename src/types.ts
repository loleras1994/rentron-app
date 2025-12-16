/* ============================================================
   HISTORY / MATERIALS
   ============================================================ */

export interface HistoryEvent {
  timestamp: string;
  type:
    | "CREATED"
    | "PLACED"
    | "MOVED"
    | "CONSUMED"
    | "PARTIALLY_CONSUMED"
    | "SYNC"        // ✅ Added for backend → frontend synchronization
    | "UPDATED";    // ✅ Added for update tracking
  details: Record<string, any>;
}

export interface MaterialLocation {
  area: string | null;     // ✅ made nullable to match backend "area" (may be null)
  position: string | null; // ✅ made nullable to match backend "position" (may be null)
}

export interface Material {
  id: string;
  materialCode: string;
  initialQuantity: number;
  currentQuantity: number;
  location: MaterialLocation | null;
  history: HistoryEvent[];
}

export interface QrData {
  id: string;
  materialCode: string;
  quantity: number;
}

/* ============================================================
   PRODUCT / ORDER / PRODUCTION SHEET
   ============================================================ */

export interface ProductMaterial {
  materialId: string;
  quantityPerPiece: number;
  totalQuantity?: number;
}

export interface ProductPhase {
  phaseId: string;
  setupTime: number;
  productionTimePerPiece: number;
  totalSetupTime?: number; 
  totalProductionTime?: number; 
  position: string;
}

export interface Product {
  id: string;
  name: string;
  materials: ProductMaterial[];
  phases: ProductPhase[];
}

export interface Order {
  orderNumber: string;
  createdAt: string;
}

export interface ProductionSheet {
  id: string;
  orderNumber: string;
  productionSheetNumber: string;
  productId: string;
  quantity: number;
  qrValue: string;
}

export interface Phase {
  id: string;
  name: string;
}

export interface PhaseLog {
  id: string;
  operatorUsername: string;
  orderNumber: string;
  productionSheetNumber: string;
  productId: string;
  phaseId: string;
  position: string;
  startTime: string;
  endTime: string | null;
  quantityDone: number;
  totalQuantity: number;
  findMaterialTime?: number;  // in seconds
  setupTime?: number;         // 🆕 total setup duration (seconds)
  productionTime?: number;    // 🆕 total production duration (seconds)
  stage: "find" | "setup" | "production";
}

export interface ProductionSheetForOperator extends ProductionSheet {
  orderNumber: string;
  product: Product;
  phaseLogs: PhaseLog[];
}

export interface ProductForUI extends Product {
  quantity?: number; // <--- AMIBITO, only for UI calculations
}

/* ============================================================
   USERS / AUTH
   ============================================================ */

export type UserRole =
  | "manager"
  | "operator"
  | "orderkeeper"
  | "machineoperator"
  | "infraoperator"
  | "storekeeper";

export type AllowedView =
  | "operator"
  | "search"
  | "manager"
  | "batch-create"
  | "transactions"
  | "orders"
  | "scan-product-sheet"
  | "daily-logs"
  | "phase-manager"
  | "history"
  | "pdf-import"
  | "live-phases"
  | "account"
  | "dead-time";

export interface User {
  id: number;
  username: string;
  roles: UserRole[];           // ✅ Array of roles (frontend format)
  allowedTabs: AllowedView[];
  createdAt: string;
  lastLogin: string | null;
  passwordHash?: string;
}

/* ============================================================
   OTHER TYPES
   ============================================================ */

export type View = AllowedView;

export type ActionType =
  | "CONSUMPTION"
  | "PLACEMENT"
  | "MOVEMENT"
  | "PARTIAL_CONSUMPTION";

export type Language = "en" | "el";

/* ============================================================
   TRANSACTIONS (DB format)
   ============================================================ */
export interface Transaction {
  id: number;
  item_id: string;
  delta: number;
  reason: string;
  user: string;
  created_at: string;
}
