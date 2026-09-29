export interface ExpenseItem {
  id: string;
  month: string; // e.g. "t3", "t4", "Tháng 03/2026", "2026-03"
  date: string; // e.g. "2026-03-15" or "15/03/2026"
  amount: number; // in VNĐ
  description: string;
  images: string[]; // Base64 data URLs
  sheetName?: string;
  notes?: string;
  profileId?: string; // e.g. "default" or custom profile ID
  createdAt: number;
  updatedAt: number;
}

export interface AdvancePaymentItem {
  id: string;
  profileId: string; // e.g. "default" or custom profile ID
  date: string; // DD/MM/YYYY
  amount: number; // in VNĐ
  note: string;
  createdAt: number;
}

export interface ExpenseProfile {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

export interface DescriptionSuggestion {
  description: string;
  count: number;
  lastAmount: number;
  lastDate: string;
}

export interface MonthGroup {
  monthKey: string;
  monthTitle: string;
  items: ExpenseItem[];
  totalAmount: number;
  count: number;
}

export interface MonthlyTrend {
  monthKey: string;
  monthTitle: string;
  totalAmount: number;
  count: number;
}

export interface ReceiptScanResult {
  amount?: number;
  description?: string;
  date?: string;
  merchant?: string;
}

export interface NaturalExpenseParsed {
  so_tien: number;
  dien_giai: string;
  ngay: string;
  rawInput?: string;
  isFallback?: boolean;
}
