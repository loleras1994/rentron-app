/// <reference types="vite/client" />
import type {
  Material,
  User,
  UserRole,
  AllowedView,
  Transaction,
  Product,
  Order,
  ProductionSheet,
  Phase,
  PhaseLog,
  ProductionSheetForOperator,
} from "../src/types";
/*import { mapPhaseLog } from "../src/mapPhaseLog";*/
import { mapDailyLog } from "../src/mapDailyLog";
/* ============================================================
   Real backend client – Express + SQLite
   ============================================================ */

const API_URL = "https://apit.rentron.gr";


/* ---------------- Generic helper ---------------- */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include", // keep session cookie
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/* ============================================================
   ROLES / TABS utility
   ============================================================ */
const getTabsForRoles = (roles: UserRole[]): AllowedView[] => {
  const tabs = new Set<AllowedView>();

  // Full access for manager (include new phase-manager tab)
  if (roles.includes("manager")) {
    [
      "orders",
      "scan-product-sheet",
      "daily-logs",
      "phase-manager",
      "batch-create",
      "operator",
      "search",
      "transactions",
      "live-phases",
      "manager",
    ].forEach((t) => tabs.add(t as AllowedView));
  }

  if (roles.includes("infraoperator")) {
    tabs.add("daily-logs");
    tabs.add("phase-manager");
    tabs.add("live-phases");
  }
  if (roles.includes("machineoperator")) {
    tabs.add("scan-product-sheet");
    tabs.add("dead-time");
  }
  if (roles.includes("orderkeeper")) {
    tabs.add("orders");
    tabs.add("pdf-import");
  }
  if (roles.includes("storekeeper")) {
    tabs.add("batch-create");
    tabs.add("transactions");
  }
  if (roles.includes("operator")) {
    tabs.add("operator");
    tabs.add("search");
  }

  return Array.from(tabs);
};

/* ============================================================
   USERS + AUTH
   ============================================================ */
export const getUsers = async (): Promise<User[]> => {
  const data = await apiFetch<any[]>("/users");
  return data.map((u) => ({
    id: u.id,
    username: u.username,
    roles: [u.role],
    allowedTabs: u.allowedTabs || [],
    createdAt: u.created_at,
    lastLogin: u.lastLogin,
    passwordHash: "",
  }));
};

// Create new user
export const createUser = async (
  userData: Pick<User, "username" | "roles"> & { password: string }
): Promise<User> => {
  const body = {
    username: userData.username,
    password: userData.password,
    role: userData.roles[0], // backend expects a single role
    allowedTabs: getTabsForRoles(userData.roles),
  };

  const created = await apiFetch<any>("/users", {
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    id: created.id,
    username: created.username,
    roles: [created.role],
    allowedTabs: created.allowedTabs || [],
    createdAt: created.created_at,
    lastLogin: created.lastLogin,
    passwordHash: "",
  };
};

// Update existing user
export const updateUser = async (
  id: number,
  updateData: Partial<Pick<User, "roles">> & { password?: string }
): Promise<User> => {
  const body: any = {};

  if (updateData.roles) {
    body.role = updateData.roles[0];
    body.allowedTabs = getTabsForRoles(updateData.roles);
  }
  if (updateData.password) {
    body.password = updateData.password;
  }

  const updated = await apiFetch<any>(`/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  return {
    id: updated.id,
    username: updated.username,
    roles: [updated.role],
    allowedTabs: updated.allowedTabs || [],
    createdAt: updated.created_at,
    lastLogin: updated.lastLogin,
    passwordHash: "",
  };
};

export const login = async (username: string, password: string): Promise<User> => {
  const user = await apiFetch<any>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return {
    id: user.id,
    username: user.username,
    roles: [user.role],
    allowedTabs: user.allowedTabs,
    createdAt: user.created_at,
    lastLogin: user.lastLogin,
    passwordHash: "",
  };
};

export const logout = async (): Promise<void> => {
  try {
    await apiFetch("/logout", { method: "POST" });
  } catch (err) {
    console.error("Logout failed:", err);
  } finally {
    window.location.href = "/login";
  }
};

export const getCurrentUser = async (): Promise<User | null> => {
  try {
    const u = await apiFetch<any>("/session");
    return {
      id: u.id,
      username: u.username,
      roles: [u.role],
      allowedTabs: u.allowedTabs,
      createdAt: u.created_at,
      lastLogin: u.lastLogin,
      passwordHash: "",
    };
  } catch {
    return null;
  }
};

/* ============================================================
   MATERIALS / ITEMS
   ============================================================ */
export const getMaterials = async (): Promise<Material[]> => {
  const items = await apiFetch<any[]>("/items");
  return items.map((i) => ({
    id: String(i.id),
    materialCode: i.sku || i.name,
    initialQuantity: i.quantity,
    currentQuantity: i.quantity,
    location:
      i.area && i.position ? { area: i.area, position: i.position } : null,
    history: [
      {
        timestamp: i.updated_at || i.created_at,
        type: "CREATED",
        details: { quantity: i.quantity },
      },
    ],
  }));
};

export const getMaterialById = async (id: string): Promise<Material | undefined> => {
  const i = await apiFetch<any>(`/items/${id}`).catch(() => undefined);
  if (!i) return undefined;
  return {
    id: String(i.id),
    materialCode: i.sku || i.name,
    initialQuantity: i.quantity,
    currentQuantity: i.quantity,
    location:
      i.area && i.position ? { area: i.area, position: i.position } : null,
    history: [
      {
        timestamp: i.updated_at || i.created_at,
        type: "CREATED",
        details: { quantity: i.quantity },
      },
    ],
  };
};

export const createMaterial = async (
  materialCode: string,
  quantity: number
): Promise<Material> => {
  const newItem = await apiFetch<any>("/items", {
    method: "POST",
    body: JSON.stringify({
      name: materialCode,
      sku: materialCode,
      quantity,
      price: 0,
      category: null,
    }),
  });
  return {
    id: String(newItem.id),
    materialCode: newItem.sku || newItem.name,
    initialQuantity: newItem.quantity,
    currentQuantity: newItem.quantity,
    location:
      newItem.area && newItem.position
        ? { area: newItem.area, position: newItem.position }
        : null,
    history: [
      {
        timestamp: newItem.created_at,
        type: "CREATED",
        details: { quantity: newItem.quantity },
      },
    ],
  };
};

export const updateMaterial = async (
  id: string,
  updateFn: (material: Material) => Material
): Promise<Material> => {
  const existing = await getMaterialById(id);
  if (!existing) throw new Error("Material not found.");
  const updated = updateFn({ ...existing });
  const body = {
    name: updated.materialCode,
    sku: updated.materialCode,
    quantity: updated.currentQuantity,
    price: 0,
    category: null,
    area: updated.location?.area || null,
    position: updated.location?.position || null,
  };
  const result = await apiFetch<any>(`/items/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return {
    id: String(result.id),
    materialCode: result.sku || result.name,
    initialQuantity: result.quantity,
    currentQuantity: result.quantity,
    location:
      result.area && result.position
        ? { area: result.area, position: result.position }
        : null,
    history: [
      {
        timestamp: result.updated_at,
        type: "CREATED",
        details: { quantity: result.quantity },
      },
    ],
  };
};

/* ============================================================
   TRANSACTIONS
   ============================================================ */
export const getTransactions = async (): Promise<Transaction[]> =>
  apiFetch<Transaction[]>("/transactions");

/* ============================================================
   PRODUCTION / ORDERS / PHASES / LOGS
   ============================================================ */
export const getProducts = async (): Promise<Product[]> =>
  apiFetch<Product[]>("/products");

export const saveProduct = async (product: Product): Promise<Product> => {
  const payload = {
    ...product,
    name: product.name || product.id,  // 🔥 ALWAYS include name
  };

  return apiFetch<Product>("/products", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const getOrders = async (): Promise<Order[]> =>
  apiFetch<Order[]>("/orders");

export const createOrder = async (orderNumber: string): Promise<Order> =>
  apiFetch<Order>("/orders", {
    method: "POST",
    body: JSON.stringify({ orderNumber }),
  });

export const getSheetsByOrderId = async (
  orderNumber: string
): Promise<ProductionSheet[]> => apiFetch(`/production_sheets/${orderNumber}`);

export const createOrderAndSheets = async (
  orderNumber: string,
  sheets: Omit<ProductionSheet, "id" | "qrValue">[]
): Promise<ProductionSheet[]> =>
  apiFetch<ProductionSheet[]>("/production_sheets", {
    method: "POST",
    body: JSON.stringify({ orderNumber, sheets }),
  });

export const getProductionSheetByQr = async (
  qr: string
): Promise<ProductionSheetForOperator> =>
  apiFetch<ProductionSheetForOperator>(
    `/production_sheet_by_qr/${encodeURIComponent(qr)}`
  );

export const updateProductionSheet = async (
  productionSheetNumber: string,
  data: {
    quantity: number;
    productDef: {
      id: string;
      name: string;
      materials: { materialId: string; quantityPerPiece: number }[];
      phases: { phaseId: string; position: number; setupTime: number; productionTimePerPiece: number }[];
    };
  }
) => {
  return apiFetch(`/production_sheets/${productionSheetNumber}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
};

export const getPhases = async (): Promise<Phase[]> =>
  apiFetch<Phase[]>("/phases");

export const savePhases = async (phases: Phase[]): Promise<Phase[]> =>
  apiFetch<Phase[]>("/phases", {
    method: "POST",
    body: JSON.stringify({ phases }),
  });

export const getPhaseLogs = async (): Promise<PhaseLog[]> =>
  apiFetch<PhaseLog[]>("/phase_logs");

export const startPhase = async (data: {
  operatorUsername: string;
  orderNumber: string;
  productionSheetNumber: string;
  productId: string;
  phaseId: string;
  startTime: string;
  totalQuantity: number;
  findMaterialTime?: number;
  setupTime?: number;
  stage: string;
}): Promise<PhaseLog> =>
  apiFetch<PhaseLog>("/phase_logs/start", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const finishPhase = async (
  id: string,
  endTime: string,
  quantityDone: number,
  timeSeconds: number
) =>
  apiFetch(`/phase_logs/finish/${id}`, {
    method: "POST",
    body: JSON.stringify({
      endTime,
      quantityDone,
      timeSeconds,
    }),
  });

export const getDailyLogs = async () => {
  const rows = await apiFetch<any[]>(`/daily_logs`);
  return rows.map(mapDailyLog);
};

export const createPhase = (id: string, name: string) =>
  apiFetch("/phases/create", {
    method: "POST",
    body: JSON.stringify({ id, name }),
  });

export const updatePhase = (id: string, name: string) =>
  apiFetch(`/phases/${id}`, { method: "PUT", body: JSON.stringify({ name }) });

export const deletePhase = (id: string) =>
  apiFetch(`/phases/${id}`, { method: "DELETE" });


export interface ParsedPdfMulti {
  orderNumber: string;
  sheets: {
    sheetNumber: string;
    quantity: number;
    productDef: {
      id: string;
      name: string;
      materials: { materialId: string; quantityPerPiece: number }[];
      phases: {
        phaseId: string;
        position: number;
        setupTime: number;
        productionTimePerPiece: number;
      }[];
    };
  }[];
}

export const parseOrderPdf = async (file: File): Promise<ParsedPdfMulti> => {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_URL}/parse_order_pdf`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Failed to parse PDF: ${res.status}`);
  }

  const parsedData = await res.json();
  console.log("Parsed data from backend:", parsedData);  // Debugging log

  return parsedData;
};


export const updateMyPassword = async (oldPassword: string, newPassword: string) => {
  return apiFetch("/me/password", {
    method: "PUT",
    body: JSON.stringify({ oldPassword, newPassword }),
  });
};


export async function getMyActivePhase() {
  const r = await fetch(`${API_URL}/api/phase-logs/my-active`, {
    method: "GET",
    credentials: "include",
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}


export async function getMaterial(id: string): Promise<Material | null> {
  try {
    const i = await apiFetch<any>(`/items/${id}`);
    return {
      id: String(i.id),
      materialCode: i.sku || i.name,
      initialQuantity: i.quantity,
      currentQuantity: i.quantity,
      location:
        i.area && i.position ? { area: i.area, position: i.position } : null,
      history: [
        {
          timestamp: i.updated_at || i.created_at,
          type: "CREATED",
          details: { quantity: i.quantity },
        },
      ],
    };
  } catch {
    return null;
  }
}


export async function searchMaterials(term: string): Promise<Material[]> {
  return apiFetch<Material[]>(
    `/api/materials/search?term=${encodeURIComponent(term)}`
  );
}

export async function placeMaterial(id: string, area: string, position: string) {
  return apiFetch(`/materials/place`, {
    method: "POST",
    body: JSON.stringify({ materialId: id, area, position })
  });
}

export async function moveMaterial(id: string, area: string, position: string) {
  return apiFetch(`/materials/move`, {
    method: "POST",
    body: JSON.stringify({ materialId: id, newArea: area, newPosition: position })
  });
}

export async function consumeMaterial(
  id: string,
  qty: number,
  productionCode: string,
  moveRemaining?: { area: string; position: string }
) {
  return apiFetch(`/materials/consume`, {
    method: "POST",
    body: JSON.stringify({
      materialId: id,
      qty,
      productionCode,
      moveRemaining,
    })
  });
}

// =============== LIVE PHASE DASHBOARD API ===============
export async function getLiveStatus() {
  const raw = await apiFetch<any>("/api/live/status");

  return {
    active: (raw.active || []).map((a: any) => ({
      username: a.username,
      sheetId: a.sheet_id,
      productionSheetNumber: a.production_sheet_number,
      productId: a.product_id,
      phaseId: a.phase_id,
      plannedTime: a.planned_time,
      status: a.status,
      runningSeconds: a.running_seconds,
      isOverrun: a.is_overrun,
    })),

    dead: (raw.dead || []).map((d: any) => ({
      id: d.id,
      username: d.username,
      code: d.code,
      description: d.description,
      productId: d.product_id,
      sheetId: d.sheet_id,
      orderNumber: d.order_number,
      productionSheetNumber: d.production_sheet_number,
      runningSeconds: d.running_seconds,
    })),

    idle: (raw.idle || []).map((u: any) => ({
      username: u.username,
      kind: u.kind,

      lastSheetId: u.last_sheet_id,
      lastSheetNumber: u.last_sheet_number,
      lastPhaseId: u.last_phase_id,

      deadCode: u.dead_code,
      deadDescription: u.dead_description,
      deadProductId: u.dead_product_id,
      deadSheetId: u.dead_sheet_id,
      deadOrderNumber: u.dead_order_number,
      deadProductionSheetNumber: u.dead_production_sheet_number,

      finishedAt: u.finished_at,
      idleSeconds: u.idle_seconds,
    })),
  };
}


export async function startLivePhase(data: {
  username: string;
  sheetId: string;
  productId: string;
  phaseId: string;
  plannedTime: number; 
  status?: string; 
}) {
  console.log("📡 SENDING LIVE START", data);
  return apiFetch<any>("/api/live/start", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function stopLivePhase(username: string) {
  return apiFetch<any>("/api/live/stop", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

// =============== DEAD TIME API ===============
export async function startDeadTime(data: {
  username: string;
  code: number;
  description: string;
  productId?: string;
  sheetId?: string;
  orderNumber?: string;
  productionSheetNumber?: string;
}) {
  return apiFetch<any>("/deadtime/start", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function finishDeadTime(id: string) {
  return apiFetch<any>(`/deadtime/finish/${id}`, {
    method: "POST",
  });
}


/* ============================================================
   HEALTH CHECK
   ============================================================ */
export const pingServer = async () =>
  apiFetch<{ ok: boolean; time: string }>("/health");
