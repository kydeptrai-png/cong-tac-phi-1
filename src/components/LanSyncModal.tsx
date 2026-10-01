import React, { useState, useEffect } from 'react';
import {
  Wifi,
  X,
  Copy,
  Check,
  Laptop,
  Smartphone,
  RefreshCw,
  Send,
  Download,
  Sparkles,
  QrCode,
  Link2,
  Power,
  Radio,
  ShieldCheck,
  Server,
  Edit3,
} from 'lucide-react';
import {
  LanSyncConnectionState,
  LanPeerInfo,
  LanActivityLogItem,
  generateRandomRoomCode,
  getAutoJoinLanRoom,
  setAutoJoinLanRoom,
  getCustomHubUrl,
  setCustomHubUrl,
  resolveHubBaseUrl,
} from '../utils/lanSync';

interface LanSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: LanSyncConnectionState;
  roomCode: string;
  deviceName: string;
  onUpdateDeviceName: (name: string) => void;
  peers: LanPeerInfo[];
  activityLogs: LanActivityLogItem[];
  localExpensesCount: number;
  localImagesCount: number;
  onConnectRoom: (code: string) => void;
  onDisconnectRoom: () => void;
  onPushFullStateToPeers: (mode: 'merge' | 'replace') => void;
  onRequestFullStateFromPeers: () => void;
}

export const LanSyncModal: React.FC<LanSyncModalProps> = ({
  isOpen,
  onClose,
  status,
  roomCode,
  deviceName,
  onUpdateDeviceName,
  peers,
  activityLogs,
  localExpensesCount,
  localImagesCount,
  onConnectRoom,
  onDisconnectRoom,
  onPushFullStateToPeers,
  onRequestFullStateFromPeers,
}) => {
  const [inputCode, setInputCode] = useState<string>(roomCode || '');
  const [editingName, setEditingName] = useState<boolean>(false);
  const [tempName, setTempName] = useState<string>(deviceName);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [showQrCode, setShowQrCode] = useState<boolean>(false);
  const [autoJoin, setAutoJoin] = useState<boolean>(() => getAutoJoinLanRoom());
  const [showAdvancedServer, setShowAdvancedServer] = useState<boolean>(false);
  const [customHub, setCustomHub] = useState<string>(() => getCustomHubUrl());
  const [serverLanIps, setServerLanIps] = useState<{ port: number; lanIps: string[] } | null>(
    null
  );

  useEffect(() => {
    if (roomCode) {
      setInputCode(roomCode);
    } else if (!inputCode) {
      setInputCode(generateRandomRoomCode());
    }
  }, [roomCode, isOpen]);

  useEffect(() => {
    setTempName(deviceName);
  }, [deviceName]);

  useEffect(() => {
    if (!isOpen) return;
    const baseUrl = resolveHubBaseUrl();
    fetch(`${baseUrl}/api/lan-sync/info`)
      .then((r) => r.json())
      .then((data) => {
        if (data && Array.isArray(data.lanIps)) {
          setServerLanIps({
            port: Number(data.port || 3000),
            lanIps: data.lanIps,
          });
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const isConnected = status === 'connected' && Boolean(roomCode);

  const getPairUrl = () => {
    const base =
      typeof window !== 'undefined' &&
      !window.location.origin.includes('localhost') &&
      !window.location.protocol.startsWith('capacitor')
        ? window.location.origin
        : resolveHubBaseUrl();
    return `${base}/?lan=${encodeURIComponent(roomCode || inputCode)}`;
  };

  const handleCopyCode = () => {
    const codeToCopy = roomCode || inputCode;
    if (!codeToCopy) return;
    navigator.clipboard?.writeText(codeToCopy);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleCopyLink = () => {
    const link = getPairUrl();
    navigator.clipboard?.writeText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleToggleAutoJoin = (checked: boolean) => {
    setAutoJoin(checked);
    setAutoJoinLanRoom(checked);
  };

  const handleSaveDeviceName = () => {
    if (tempName.trim()) {
      onUpdateDeviceName(tempName.trim());
    }
    setEditingName(false);
  };

  const formattedRoomCode = (roomCode || inputCode)
    .replace(/\s+/g, '')
    .replace(/(\d{3})(\d+)/, '$1 $2');

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Wifi size={20} className="text-teal-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">
                  Đồng bộ LAN / P2P Thời Gian Thực
                </h2>
                {isConnected && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/25 text-emerald-200 border border-emerald-400/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    Đang bật
                  </span>
                )}
              </div>
              <p className="text-[11px] text-teal-200/90 mt-0.5">
                Truyền trực tiếp khoản chi &amp; ảnh chứng từ gốc giữa Máy tính ↔ Điện thoại không cần tài khoản
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Device Identity Bar */}
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 min-w-0">
              <Laptop size={16} className="text-teal-700 shrink-0" />
              <span className="text-xs text-slate-500 shrink-0">Tên máy này:</span>
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveDeviceName()}
                    className="px-2 py-1 text-xs font-semibold border border-teal-500 rounded-lg focus:outline-hidden"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleSaveDeviceName}
                    className="px-2 py-1 text-[11px] font-bold bg-teal-700 text-white rounded-lg cursor-pointer"
                  >
                    Lưu
                  </button>
                </div>
              ) : (
                <span className="text-xs font-bold text-slate-800 truncate">{deviceName}</span>
              )}
            </div>

            {!editingName && (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="text-[11px] font-semibold text-teal-700 hover:text-teal-900 flex items-center gap-1 shrink-0 cursor-pointer"
              >
                <Edit3 size={12} />
                <span>Đổi tên</span>
              </button>
            )}
          </div>

          {/* Room Connection Card */}
          {!isConnected ? (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-teal-50/90 to-emerald-50/50 border border-teal-200/80 space-y-3.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-teal-950 uppercase tracking-wide">
                    Nhập Mã Ghép Đôi (6 chữ số)
                  </h3>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Mở mục này trên cả 2 thiết bị và nhập chung một mã 6 số để nối mạng trực tiếp:
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setInputCode(generateRandomRoomCode())}
                  className="text-[11px] font-semibold text-teal-700 hover:text-teal-950 flex items-center gap-1 bg-white px-2.5 py-1 rounded-lg border border-teal-200 shadow-2xs cursor-pointer"
                >
                  <RefreshCw size={12} />
                  <span>Đổi mã khác</span>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <input
                  type="text"
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12))}
                  placeholder="VD: 889900"
                  className="flex-1 px-4 py-3 text-xl font-mono font-bold tracking-widest text-center text-teal-950 bg-white rounded-xl border-2 border-teal-300 focus:outline-hidden focus:border-teal-600"
                />
                <button
                  type="button"
                  disabled={!inputCode.trim() || status === 'connecting'}
                  onClick={() => onConnectRoom(inputCode.trim())}
                  className="px-5 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                >
                  {status === 'connecting' ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Đang kết nối...</span>
                    </>
                  ) : (
                    <>
                      <Radio size={17} />
                      <span>Kết nối ngay</span>
                    </>
                  )}
                </button>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  checked={autoJoin}
                  onChange={(e) => handleToggleAutoJoin(e.target.checked)}
                  className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>Tự động kết nối lại phòng này khi mở ứng dụng lần sau</span>
              </label>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50 via-teal-50/70 to-white border-2 border-emerald-300/80 space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
                    Mã phòng đang hoạt động
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xl sm:text-3xl font-mono font-black tracking-widest text-teal-950">
                      {formattedRoomCode}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="px-2.5 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 border border-slate-200 flex items-center gap-1 shadow-2xs cursor-pointer"
                    >
                      {copiedCode ? (
                        <>
                          <Check size={13} className="text-emerald-600" />
                          <span className="text-emerald-700">Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy size={13} />
                          <span>Chép mã</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowQrCode((v) => !v)}
                    className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-teal-50 text-teal-900 border border-teal-200 text-xs font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <QrCode size={14} />
                    <span>{showQrCode ? 'Ẩn QR' : 'Mã QR'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-teal-50 text-teal-900 border border-teal-200 text-xs font-semibold flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    {copiedLink ? <Check size={14} className="text-emerald-600" /> : <Link2 size={14} />}
                    <span>{copiedLink ? 'Đã chép link' : 'Link ghép đôi'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onDisconnectRoom}
                    title="Ngắt kết nối phòng LAN"
                    className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                  >
                    <Power size={13} />
                    <span>Ngắt</span>
                  </button>
                </div>
              </div>

              {/* QR Code Panel for instant mobile pairing */}
              {showQrCode && (
                <div className="p-3.5 bg-white rounded-xl border border-emerald-200 flex flex-col sm:flex-row items-center gap-4">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                      getPairUrl()
                    )}`}
                    alt="QR Code ghép đôi LAN"
                    className="w-32 h-32 rounded-lg border border-slate-200 p-1 bg-white shrink-0"
                  />
                  <div className="text-xs space-y-1.5 text-slate-600">
                    <p className="font-bold text-slate-800">
                      Quét bằng Camera / Zalo trên điện thoại để ghép đôi tức thì:
                    </p>
                    <p>
                      • Hoặc mở ứng dụng trên thiết bị kia, bấm nút{' '}
                      <strong className="text-teal-800">Đồng bộ LAN</strong> và nhập mã{' '}
                      <strong className="font-mono text-teal-900">{roomCode}</strong>.
                    </p>
                    <p className="text-[11px] text-slate-400 break-all font-mono">{getPairUrl()}</p>
                  </div>
                </div>
              )}

              {/* Connected Peers List */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">
                    Thiết bị đang kết nối trong phòng ({peers.length}):
                  </span>
                  <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                    <ShieldCheck size={13} />
                    Tự động đồng bộ 2 chiều
                  </span>
                </div>

                {peers.length === 0 ? (
                  <div className="p-3 rounded-xl bg-white/90 border border-dashed border-slate-300 text-center text-xs text-slate-500">
                    Đang chờ thiết bị thứ 2 nhập mã <strong className="font-mono text-slate-800">{roomCode}</strong>...
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {peers.map((peer) => (
                      <div
                        key={peer.peerId}
                        className="px-3 py-2 rounded-xl bg-white border border-emerald-200 flex items-center justify-between gap-2 shadow-2xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {peer.deviceType === 'mobile' ? (
                            <Smartphone size={16} className="text-teal-700 shrink-0" />
                          ) : (
                            <Laptop size={16} className="text-teal-700 shrink-0" />
                          )}
                          <span className="text-xs font-bold text-slate-800 truncate">
                            {peer.deviceName}
                          </span>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${
                            peer.p2pConnected
                              ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                              : 'bg-teal-50 text-teal-800 border border-teal-200'
                          }`}
                        >
                          {peer.p2pConnected ? '⚡ P2P LAN Trực Tiếp (WebRTC)' : '⚡ Real-time LAN Stream'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Instant Sync Actions */}
              <div className="pt-2 border-t border-emerald-200/70 space-y-2">
                <p className="text-[11px] font-semibold text-slate-700">
                  Đồng bộ toàn bộ dữ liệu hiện có ({localExpensesCount} khoản chi, {localImagesCount} ảnh):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onPushFullStateToPeers('merge')}
                    className="px-3 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Send size={14} />
                    <span>Gửi toàn bộ sang máy kia (Gộp)</span>
                  </button>

                  <button
                    type="button"
                    onClick={onRequestFullStateFromPeers}
                    className="px-3 py-2.5 rounded-xl bg-white hover:bg-teal-50 text-teal-900 border border-teal-300 text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Download size={14} />
                    <span>Lấy toàn bộ từ máy kia về</span>
                  </button>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoJoin}
                      onChange={(e) => handleToggleAutoJoin(e.target.checked)}
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Tự kết nối lại phòng #{roomCode} khi mở app</span>
                  </label>

                  <button
                    type="button"
                    onClick={() => onPushFullStateToPeers('replace')}
                    className="text-[11px] font-semibold text-amber-800 hover:text-amber-950 underline cursor-pointer"
                  >
                    Gửi &amp; ghi đè toàn bộ máy kia
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* How real-time sync works highlight */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-1.5 text-xs text-slate-600">
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <Sparkles size={14} className="text-teal-600" />
              <span>Tự động đồng bộ những gì?</span>
            </div>
            <ul className="space-y-1 text-[11px] pl-4 list-disc">
              <li>
                Thêm/sửa/xóa khoản chi, <strong>kéo thả ảnh chứng từ ở ngoài</strong> hoặc{' '}
                <strong>dán ảnh chụp màn hình (Ctrl+V)</strong> trên máy tính $\rightarrow$ hiện ngay trên điện thoại sau <strong>0.1 giây</strong>.
              </li>
              <li>
                Truyền trực tiếp <strong>ảnh chứng từ gốc Base64</strong> qua mạng nội bộ, không cần đăng nhập Google Drive và không lo hết dung lượng.
              </li>
            </ul>
          </div>

          {/* Live Activity Log */}
          {activityLogs.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Nhật ký truyền dữ liệu thời gian thực
              </span>
              <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white text-xs">
                {activityLogs.map((log) => (
                  <div key={log.id} className="px-3 py-2 flex items-start gap-2">
                    <span className="font-mono text-[10px] text-slate-400 shrink-0 mt-0.5">
                      {log.time}
                    </span>
                    <span
                      className={`text-[11px] font-medium ${
                        log.direction === 'in'
                          ? 'text-emerald-800'
                          : log.direction === 'out'
                          ? 'text-teal-800'
                          : 'text-slate-600'
                      }`}
                    >
                      {log.summary}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Optional Advanced LAN IP / Local Server Configuration */}
          <div className="pt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowAdvancedServer((v) => !v)}
              className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 cursor-pointer"
            >
              <Server size={12} />
              <span>
                {showAdvancedServer
                  ? 'Ẩn cấu hình IP Máy chủ LAN nội bộ'
                  : 'Cấu hình nâng cao (IP LAN nội bộ / Chạy Offline hoàn toàn)'}
              </span>
            </button>

            {showAdvancedServer && (
              <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
                {serverLanIps && serverLanIps.lanIps.length > 0 && (
                  <div className="text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">Địa chỉ IP LAN của máy chủ: </span>
                    {serverLanIps.lanIps.map((ip) => (
                      <code
                        key={ip}
                        className="mx-1 px-1.5 py-0.5 rounded bg-white border border-slate-200 font-mono text-teal-800"
                      >
                        http://{ip}:{serverLanIps.port}
                      </code>
                    ))}
                  </div>
                )}
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Địa chỉ Máy chủ điều phối (Để trống để dùng mặc định tự động):
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customHub}
                      onChange={(e) => setCustomHub(e.target.value)}
                      placeholder="VD: http://192.168.1.15:3000"
                      className="flex-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setCustomHubUrl(customHub);
                        if (roomCode) {
                          onConnectRoom(roomCode);
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold cursor-pointer"
                    >
                      Áp dụng
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
