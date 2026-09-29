import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, Download, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { downloadBackupJSON, getAllExpenses, getAllAdvances, getAllProfiles, formatBackupFileNameWithTimestamp } from '../utils/db';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isExportingEmergencyBackup: boolean;
  emergencyBackupSuccess: boolean;
  showDetails: boolean;
}

/**
 * Requirement 8: Global Error Boundary
 * Catches render errors and unhandled exceptions, showing a user-friendly Vietnamese UI
 * instead of a blank white screen, with emergency data backup and reload options.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      isExportingEmergencyBackup: false,
      emergencyBackupSuccess: false,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled React Error in Applet:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleEmergencyBackup = async () => {
    try {
      this.setState({ isExportingEmergencyBackup: true });
      const [expenses, advances, profiles] = await Promise.all([
        getAllExpenses().catch(() => []),
        getAllAdvances().catch(() => []),
        getAllProfiles().catch(() => []),
      ]);

      const fileName = formatBackupFileNameWithTimestamp('Sao_Luu_Khan_Cap_So_Chi_Tieu');
      downloadBackupJSON(expenses, fileName, advances, profiles);
      this.setState({ isExportingEmergencyBackup: false, emergencyBackupSuccess: true });
    } catch (backupErr) {
      console.error('Emergency backup failed:', backupErr);
      this.setState({ isExportingEmergencyBackup: false });
      alert('Không thể tạo file sao lưu khẩn cấp: ' + (backupErr as Error)?.message);
    }
  };

  handleResetState = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      emergencyBackupSuccess: false,
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-xl border border-slate-200">
            {/* Header Icon */}
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center mx-auto mb-4">
              <AlertOctagon size={32} />
            </div>

            <h2 className="text-xl font-bold text-slate-900 text-center mb-2">
              Đã xảy ra lỗi không mong muốn
            </h2>

            <p className="text-sm text-slate-600 text-center mb-6 leading-relaxed">
              Ứng dụng vừa gặp sự cố gián đoạn. Đừng lo lắng, toàn bộ dữ liệu chi tiêu và ảnh chứng từ của bạn vẫn được lưu trữ an toàn trong bộ nhớ máy (IndexedDB).
            </p>

            {/* Reassurance Banner */}
            <div className="p-3.5 rounded-2xl bg-teal-50 border border-teal-200 mb-6 flex items-start gap-3">
              <ShieldCheck size={20} className="text-teal-700 shrink-0 mt-0.5" />
              <div className="text-xs text-teal-900 leading-relaxed">
                <strong>Dữ liệu an toàn:</strong> Bạn có thể bấm nút "Tải sao lưu khẩn cấp" bên dưới để tải về ngay file JSON chứa toàn bộ các khoản chi tiêu và ảnh hóa đơn.
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 mb-6">
              <button
                type="button"
                onClick={this.handleEmergencyBackup}
                disabled={this.state.isExportingEmergencyBackup}
                className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
              >
                <Download size={18} />
                <span>
                  {this.state.isExportingEmergencyBackup
                    ? 'Đang tạo file sao lưu...'
                    : this.state.emergencyBackupSuccess
                    ? 'Đã tải file sao lưu thành công!'
                    : 'Tải sao lưu khẩn cấp (JSON + Ảnh)'}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={this.handleReload}
                  className="min-h-[48px] px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw size={16} />
                  <span>Tải lại trang</span>
                </button>

                <button
                  type="button"
                  onClick={this.handleResetState}
                  className="min-h-[48px] px-4 py-3 rounded-2xl border border-slate-300 hover:bg-slate-50 active:bg-slate-100 text-slate-700 font-semibold text-sm flex items-center justify-center transition-colors cursor-pointer"
                >
                  <span>Thử tiếp tục</span>
                </button>
              </div>
            </div>

            {/* Technical Details Accordion */}
            <div className="border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => this.setState({ showDetails: !this.state.showDetails })}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center justify-between w-full font-medium cursor-pointer"
              >
                <span>Chi tiết kỹ thuật dành cho nhà phát triển</span>
                {this.state.showDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {this.state.showDetails && (
                <div className="mt-3 p-3 rounded-xl bg-slate-900 text-slate-200 text-xs font-mono overflow-x-auto max-h-48">
                  <p className="font-bold text-rose-400 mb-1">
                    {this.state.error?.name}: {this.state.error?.message}
                  </p>
                  <pre className="text-[11px] text-slate-400 whitespace-pre-wrap">
                    {this.state.error?.stack}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
