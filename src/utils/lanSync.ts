import { ExpenseItem, AdvancePaymentItem, ExpenseProfile } from '../types';

export type LanSyncConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface LanPeerInfo {
  peerId: string;
  deviceName: string;
  deviceType: 'pc' | 'mobile';
  joinedAt: number;
  lastSeen: number;
  p2pConnected?: boolean;
}

export type LanSyncActionType =
  | 'sync:request_full'
  | 'sync:full_state'
  | 'sync:expense_upsert'
  | 'sync:expenses_bulk_upsert'
  | 'sync:expense_delete'
  | 'sync:expenses_bulk_delete'
  | 'sync:clear_all'
  | 'sync:advance_upsert'
  | 'sync:advance_delete'
  | 'sync:profile_upsert'
  | 'sync:profile_delete';

export interface LanSyncPayload {
  action: LanSyncActionType;
  mode?: 'merge' | 'replace';
  expense?: ExpenseItem;
  expenses?: ExpenseItem[];
  expenseId?: string;
  expenseIds?: string[];
  advance?: AdvancePaymentItem;
  advanceId?: string;
  advances?: AdvancePaymentItem[];
  profile?: ExpenseProfile;
  profileId?: string;
  profiles?: ExpenseProfile[];
  timestamp: number;
}

export interface LanActivityLogItem {
  id: string;
  time: string;
  direction: 'in' | 'out' | 'system';
  fromDeviceName: string;
  summary: string;
}

interface SignalEnvelope {
  messageId: string;
  roomCode: string;
  senderPeerId: string;
  senderDeviceName: string;
  senderDeviceType: 'pc' | 'mobile';
  targetPeerId?: string;
  kind: 'data' | 'webrtc-offer' | 'webrtc-answer' | 'webrtc-ice';
  payload: any;
  timestamp: number;
}

const LAN_ROOM_STORAGE_KEY = 'so_chi_tieu_lan_room_code';
const LAN_AUTO_JOIN_KEY = 'so_chi_tieu_lan_auto_join';
const LAN_PEER_ID_KEY = 'so_chi_tieu_lan_peer_id';
const LAN_DEVICE_NAME_KEY = 'so_chi_tieu_lan_device_name';
const LAN_CUSTOM_HUB_URL_KEY = 'so_chi_tieu_lan_hub_url';

// Default cloud hub fallback when running inside Android Capacitor APK (origin = https://localhost)
const DEFAULT_CLOUD_HUB_ORIGIN =
  'https://ais-pre-rl6yjrgnyxxcy2k7mvafgu-525335567555.asia-east1.run.app';

export function detectDeviceInfo(): { deviceName: string; deviceType: 'pc' | 'mobile' } {
  try {
    const savedName = localStorage.getItem(LAN_DEVICE_NAME_KEY);
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isAndroid = /Android/i.test(ua);
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isMobile = isAndroid || isIOS || /Mobile/i.test(ua);
    const deviceType: 'pc' | 'mobile' = isMobile ? 'mobile' : 'pc';

    if (savedName && savedName.trim()) {
      return { deviceName: savedName.trim(), deviceType };
    }

    let defaultName = 'Thiết bị';
    if (isAndroid) defaultName = 'Điện thoại Android';
    else if (isIOS) defaultName = 'iPhone / iPad';
    else if (/Windows/i.test(ua)) defaultName = 'Máy tính Windows';
    else if (/Mac/i.test(ua)) defaultName = 'Máy tính Mac';
    else if (/Linux/i.test(ua)) defaultName = 'Máy tính Linux';

    const suffix = Math.floor(10 + Math.random() * 89);
    const finalName = `${defaultName} #${suffix}`;
    localStorage.setItem(LAN_DEVICE_NAME_KEY, finalName);
    return { deviceName: finalName, deviceType };
  } catch {
    return { deviceName: 'Thiết bị LAN', deviceType: 'pc' };
  }
}

export function getOrCreatePeerId(): string {
  try {
    const existing = sessionStorage.getItem(LAN_PEER_ID_KEY) || localStorage.getItem(LAN_PEER_ID_KEY);
    if (existing) return existing;
    const created = `peer_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    sessionStorage.setItem(LAN_PEER_ID_KEY, created);
    localStorage.setItem(LAN_PEER_ID_KEY, created);
    return created;
  } catch {
    return `peer_${Math.random().toString(36).substring(2, 10)}`;
  }
}

export function getSavedRoomCode(): string {
  try {
    return localStorage.getItem(LAN_ROOM_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setSavedRoomCode(code: string): void {
  try {
    if (code) localStorage.setItem(LAN_ROOM_STORAGE_KEY, code);
    else localStorage.removeItem(LAN_ROOM_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function getAutoJoinLanRoom(): boolean {
  try {
    return localStorage.getItem(LAN_AUTO_JOIN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAutoJoinLanRoom(enabled: boolean): void {
  try {
    localStorage.setItem(LAN_AUTO_JOIN_KEY, String(enabled));
  } catch {
    // ignore
  }
}

export function getCustomHubUrl(): string {
  try {
    return localStorage.getItem(LAN_CUSTOM_HUB_URL_KEY) || '';
  } catch {
    return '';
  }
}

export function setCustomHubUrl(url: string): void {
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) localStorage.setItem(LAN_CUSTOM_HUB_URL_KEY, clean);
    else localStorage.removeItem(LAN_CUSTOM_HUB_URL_KEY);
  } catch {
    // ignore
  }
}

export function resolveHubBaseUrl(): string {
  const custom = getCustomHubUrl();
  if (custom) return custom;

  if (typeof window !== 'undefined') {
    const { protocol, hostname, origin } = window.location;
    // If running inside Capacitor Android WebView (https://localhost or capacitor://localhost)
    const isCapNative = Boolean((window as any).Capacitor?.isNativePlatform?.());
    if (isCapNative || protocol === 'capacitor:' || (hostname === 'localhost' && !window.location.port)) {
      return DEFAULT_CLOUD_HUB_ORIGIN;
    }
    return origin;
  }
  return '';
}

export function generateRandomRoomCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function formatNowTime(): string {
  return new Date().toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const WEBRTC_CHUNK_SIZE = 16000; // 16KB safe frame size for RTCDataChannel

export class LanSyncManager {
  private roomCode: string = '';
  private peerId: string;
  private deviceName: string;
  private deviceType: 'pc' | 'mobile';
  private status: LanSyncConnectionState = 'disconnected';
  private peers: Map<string, LanPeerInfo> = new Map();
  private processedMessageIds: Set<string> = new Set();

  private eventSource: EventSource | null = null;
  private pollTimer: number | null = null;
  private lastPollTimestamp: number = 0;
  private broadcastChannel: BroadcastChannel | null = null;

  // WebRTC P2P connections keyed by remote peerId
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private incomingChunks: Map<string, { total: number; parts: string[] }> = new Map();

  private onStatusChange: (status: LanSyncConnectionState, roomCode: string) => void;
  private onPeersChange: (peers: LanPeerInfo[]) => void;
  private onReceivePayload: (payload: LanSyncPayload, fromPeer: { peerId: string; deviceName: string }) => void;
  private onLogActivity: (item: LanActivityLogItem) => void;
  private getCurrentFullState: () => {
    expenses: ExpenseItem[];
    advances: AdvancePaymentItem[];
    profiles: ExpenseProfile[];
  };

  constructor(callbacks: {
    onStatusChange: (status: LanSyncConnectionState, roomCode: string) => void;
    onPeersChange: (peers: LanPeerInfo[]) => void;
    onReceivePayload: (
      payload: LanSyncPayload,
      fromPeer: { peerId: string; deviceName: string }
    ) => void;
    onLogActivity: (item: LanActivityLogItem) => void;
    getCurrentFullState: () => {
      expenses: ExpenseItem[];
      advances: AdvancePaymentItem[];
      profiles: ExpenseProfile[];
    };
  }) {
    this.peerId = getOrCreatePeerId();
    const info = detectDeviceInfo();
    this.deviceName = info.deviceName;
    this.deviceType = info.deviceType;

    this.onStatusChange = callbacks.onStatusChange;
    this.onPeersChange = callbacks.onPeersChange;
    this.onReceivePayload = callbacks.onReceivePayload;
    this.onLogActivity = callbacks.onLogActivity;
    this.getCurrentFullState = callbacks.getCurrentFullState;
  }

  public getPeerId(): string {
    return this.peerId;
  }

  public getDeviceName(): string {
    return this.deviceName;
  }

  public setDeviceName(name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.deviceName = clean;
    try {
      localStorage.setItem(LAN_DEVICE_NAME_KEY, clean);
    } catch {
      // ignore
    }
  }

  public getRoomCode(): string {
    return this.roomCode;
  }

  public getStatus(): LanSyncConnectionState {
    return this.status;
  }

  private log(direction: 'in' | 'out' | 'system', fromDeviceName: string, summary: string) {
    this.onLogActivity({
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      time: formatNowTime(),
      direction,
      fromDeviceName,
      summary,
    });
  }

  private emitPeers() {
    const list = Array.from(this.peers.values()).filter((p) => p.peerId !== this.peerId);
    list.forEach((p) => {
      const dc = this.dataChannels.get(p.peerId);
      p.p2pConnected = Boolean(dc && dc.readyState === 'open');
    });
    this.onPeersChange(list);
  }

  public async connect(rawRoomCode: string): Promise<void> {
    const cleanCode = rawRoomCode.replace(/\s+/g, '').trim();
    if (!cleanCode) return;

    this.disconnect(false);
    this.roomCode = cleanCode;
    setSavedRoomCode(cleanCode);
    this.status = 'connecting';
    this.onStatusChange('connecting', cleanCode);
    this.lastPollTimestamp = Date.now() - 5000;

    // 1. Setup same-browser BroadcastChannel for instant zero-latency local tab sync
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel(`so_chi_tieu_lan_${cleanCode}`);
        this.broadcastChannel.onmessage = (ev) => {
          if (ev.data) {
            this.handleIncomingEnvelope(ev.data);
          }
        };
      }
    } catch {
      // ignore if BroadcastChannel unsupported
    }

    const baseUrl = resolveHubBaseUrl();
    const streamUrl = `${baseUrl}/api/lan-sync/stream?roomCode=${encodeURIComponent(
      cleanCode
    )}&peerId=${encodeURIComponent(this.peerId)}&deviceName=${encodeURIComponent(
      this.deviceName
    )}&deviceType=${encodeURIComponent(this.deviceType)}`;

    // 2. Connect Server-Sent Events (SSE) for instant server-assisted LAN signaling & relay
    try {
      const es = new EventSource(streamUrl);
      this.eventSource = es;

      es.onopen = () => {
        this.status = 'connected';
        this.onStatusChange('connected', this.roomCode);
        this.log('system', 'Hệ thống', `Đã kết nối vào phòng đồng bộ #${this.roomCode}`);
      };

      es.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          this.handleServerStreamEvent(parsed);
        } catch (err) {
          console.warn('[LAN Sync] Parse stream message error:', err);
        }
      };

      es.onerror = () => {
        // Polling fallback will still keep working seamlessly even if SSE reconnects
        if (this.status === 'connecting') {
          this.status = 'connected';
          this.onStatusChange('connected', this.roomCode);
        }
      };
    } catch (err) {
      console.warn('[LAN Sync] EventSource fallback to polling:', err);
      this.status = 'connected';
      this.onStatusChange('connected', this.roomCode);
    }

    // 3. Also start lightweight HTTP Poll fallback (every 2.5s) in case proxy buffers SSE
    this.pollTimer = window.setInterval(() => {
      this.pollMessages();
    }, 2500);

    // Run initial poll immediately
    this.pollMessages();
  }

  public disconnect(clearSavedAutoJoin = false): void {
    const oldRoom = this.roomCode;
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    // Close all WebRTC connections
    this.dataChannels.forEach((dc) => {
      try {
        dc.close();
      } catch {}
    });
    this.dataChannels.clear();

    this.peerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {}
    });
    this.peerConnections.clear();
    this.peers.clear();

    if (oldRoom) {
      const baseUrl = resolveHubBaseUrl();
      fetch(`${baseUrl}/api/lan-sync/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode: oldRoom, peerId: this.peerId }),
      }).catch(() => {});
    }

    if (clearSavedAutoJoin) {
      setAutoJoinLanRoom(false);
    }

    this.roomCode = '';
    this.status = 'disconnected';
    this.onStatusChange('disconnected', '');
    this.emitPeers();
  }

  private async pollMessages() {
    if (!this.roomCode) return;
    const baseUrl = resolveHubBaseUrl();
    try {
      const res = await fetch(
        `${baseUrl}/api/lan-sync/poll?roomCode=${encodeURIComponent(
          this.roomCode
        )}&peerId=${encodeURIComponent(this.peerId)}&deviceName=${encodeURIComponent(
          this.deviceName
        )}&deviceType=${encodeURIComponent(this.deviceType)}&since=${this.lastPollTimestamp}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (this.status !== 'connected') {
        this.status = 'connected';
        this.onStatusChange('connected', this.roomCode);
      }
      if (Array.isArray(data.peers)) {
        this.updatePeersList(data.peers);
      }
      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          if (msg.timestamp > this.lastPollTimestamp) {
            this.lastPollTimestamp = msg.timestamp;
          }
          this.handleIncomingEnvelope(msg);
        }
      }
    } catch {
      // ignore transient network errors
    }
  }

  private handleServerStreamEvent(data: any) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'room:state' && Array.isArray(data.peers)) {
      this.updatePeersList(data.peers);
      return;
    }
    if (data.type === 'peer:joined' && data.peer) {
      const p: LanPeerInfo = data.peer;
      if (p.peerId !== this.peerId) {
        const isNew = !this.peers.has(p.peerId);
        this.peers.set(p.peerId, p);
        this.emitPeers();
        if (isNew) {
          this.log('system', p.deviceName, `${p.deviceName} vừa tham gia phòng`);
          // Initiate WebRTC P2P offer to the new peer
          this.initiateWebRTCOffer(p.peerId);
        }
      }
      return;
    }
    if (data.type === 'peer:left' && data.peerId) {
      const leaving = this.peers.get(data.peerId);
      if (leaving) {
        this.log('system', leaving.deviceName, `${leaving.deviceName} đã rời phòng`);
      }
      this.peers.delete(data.peerId);
      this.cleanupWebRTCPeer(data.peerId);
      this.emitPeers();
      return;
    }
    if (data.type === 'envelope' && data.envelope) {
      if (data.envelope.timestamp > this.lastPollTimestamp) {
        this.lastPollTimestamp = data.envelope.timestamp;
      }
      this.handleIncomingEnvelope(data.envelope);
    }
  }

  private updatePeersList(serverPeers: LanPeerInfo[]) {
    const nextMap = new Map<string, LanPeerInfo>();
    for (const p of serverPeers) {
      if (p.peerId === this.peerId) continue;
      const wasKnown = this.peers.has(p.peerId);
      nextMap.set(p.peerId, p);
      if (!wasKnown && this.peerId < p.peerId) {
        this.initiateWebRTCOffer(p.peerId);
      }
    }
    this.peers = nextMap;
    this.emitPeers();
  }

  // ============================================================================
  // WEBRTC P2P DATACHANNEL (DIRECT LAN TRANSFER)
  // ============================================================================
  private getOrCreatePeerConnection(remotePeerId: string): RTCPeerConnection | null {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const existing = this.peerConnections.get(remotePeerId);
    if (existing && existing.connectionState !== 'Closed' as any && existing.connectionState !== 'failed') {
      return existing;
    }

    try {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.sendSignalEnvelope({
            kind: 'webrtc-ice',
            targetPeerId: remotePeerId,
            payload: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate,
          });
        }
      };

      pc.ondatachannel = (ev) => {
        this.setupDataChannel(remotePeerId, ev.channel);
      };

      pc.onconnectionstatechange = () => {
        this.emitPeers();
      };

      this.peerConnections.set(remotePeerId, pc);
      return pc;
    } catch {
      return null;
    }
  }

  private setupDataChannel(remotePeerId: string, channel: RTCDataChannel) {
    this.dataChannels.set(remotePeerId, channel);

    channel.onopen = () => {
      this.emitPeers();
      const peer = this.peers.get(remotePeerId);
      if (peer) {
        this.log(
          'system',
          peer.deviceName,
          `Đã thiết lập kênh truyền P2P trực tiếp qua mạng LAN với ${peer.deviceName}`
        );
      }
    };

    channel.onclose = () => {
      this.emitPeers();
    };

    channel.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.chunked) {
          const { transferId, index, total, data } = msg;
          let entry = this.incomingChunks.get(transferId);
          if (!entry) {
            entry = { total, parts: new Array(total).fill('') };
            this.incomingChunks.set(transferId, entry);
          }
          entry.parts[index] = data;
          const receivedAll = entry.parts.every((part) => part.length > 0);
          if (receivedAll) {
            this.incomingChunks.delete(transferId);
            const fullJson = entry.parts.join('');
            const envelope: SignalEnvelope = JSON.parse(fullJson);
            this.handleIncomingEnvelope(envelope);
          }
        } else {
          this.handleIncomingEnvelope(msg);
        }
      } catch (err) {
        console.warn('[LAN Sync] DataChannel parse error:', err);
      }
    };
  }

  private async initiateWebRTCOffer(remotePeerId: string) {
    const pc = this.getOrCreatePeerConnection(remotePeerId);
    if (!pc) return;
    try {
      const dc = pc.createDataChannel('lan-sync-p2p', { ordered: true });
      this.setupDataChannel(remotePeerId, dc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.sendSignalEnvelope({
        kind: 'webrtc-offer',
        targetPeerId: remotePeerId,
        payload: pc.localDescription,
      });
    } catch {
      // Fallback to server stream remains active
    }
  }

  private cleanupWebRTCPeer(remotePeerId: string) {
    const dc = this.dataChannels.get(remotePeerId);
    if (dc) {
      try {
        dc.close();
      } catch {}
      this.dataChannels.delete(remotePeerId);
    }
    const pc = this.peerConnections.get(remotePeerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peerConnections.delete(remotePeerId);
    }
  }

  private sendOverWebRTCIfOpen(envelope: SignalEnvelope): boolean {
    const serialized = JSON.stringify(envelope);
    let sentToAllKnownPeers = this.peers.size > 0;

    for (const [remotePeerId] of this.peers) {
      if (envelope.targetPeerId && envelope.targetPeerId !== remotePeerId) continue;
      const dc = this.dataChannels.get(remotePeerId);
      if (!dc || dc.readyState !== 'open') {
        sentToAllKnownPeers = false;
        continue;
      }
      try {
        if (serialized.length <= WEBRTC_CHUNK_SIZE) {
          dc.send(serialized);
        } else {
          const transferId = `${envelope.messageId}_${remotePeerId}`;
          const total = Math.ceil(serialized.length / WEBRTC_CHUNK_SIZE);
          for (let i = 0; i < total; i++) {
            const slice = serialized.slice(i * WEBRTC_CHUNK_SIZE, (i + 1) * WEBRTC_CHUNK_SIZE);
            dc.send(
              JSON.stringify({
                chunked: true,
                transferId,
                index: i,
                total,
                data: slice,
              })
            );
          }
        }
      } catch {
        sentToAllKnownPeers = false;
      }
    }

    return sentToAllKnownPeers;
  }

  private async handleIncomingEnvelope(envelope: SignalEnvelope) {
    if (!envelope || !envelope.messageId) return;
    if (envelope.senderPeerId === this.peerId) return;
    if (envelope.targetPeerId && envelope.targetPeerId !== this.peerId) return;

    if (this.processedMessageIds.has(envelope.messageId)) return;
    this.processedMessageIds.add(envelope.messageId);
    if (this.processedMessageIds.size > 1000) {
      const first = this.processedMessageIds.values().next().value;
      if (first) this.processedMessageIds.delete(first);
    }

    // Track sender peer
    if (!this.peers.has(envelope.senderPeerId)) {
      this.peers.set(envelope.senderPeerId, {
        peerId: envelope.senderPeerId,
        deviceName: envelope.senderDeviceName || 'Thiết bị khác',
        deviceType: envelope.senderDeviceType || 'pc',
        joinedAt: Date.now(),
        lastSeen: Date.now(),
      });
      this.emitPeers();
    }

    // Handle WebRTC signaling
    if (envelope.kind === 'webrtc-offer') {
      const pc = this.getOrCreatePeerConnection(envelope.senderPeerId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(envelope.payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.sendSignalEnvelope({
          kind: 'webrtc-answer',
          targetPeerId: envelope.senderPeerId,
          payload: pc.localDescription,
        });
      } catch {}
      return;
    }

    if (envelope.kind === 'webrtc-answer') {
      const pc = this.peerConnections.get(envelope.senderPeerId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(envelope.payload));
      } catch {}
      return;
    }

    if (envelope.kind === 'webrtc-ice') {
      const pc = this.peerConnections.get(envelope.senderPeerId);
      if (!pc || !envelope.payload) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(envelope.payload));
      } catch {}
      return;
    }

    // Handle Real-Time Data Sync
    if (envelope.kind === 'data' && envelope.payload) {
      const dataPayload: LanSyncPayload = envelope.payload;

      if (dataPayload.action === 'sync:request_full') {
        const current = this.getCurrentFullState();
        this.log(
          'out',
          envelope.senderDeviceName,
          `Đang gửi toàn bộ ${current.expenses.length} khoản chi sang ${envelope.senderDeviceName}`
        );
        await this.broadcastData({
          action: 'sync:full_state',
          mode: dataPayload.mode || 'merge',
          expenses: current.expenses,
          advances: current.advances,
          profiles: current.profiles,
          timestamp: Date.now(),
        });
        return;
      }

      const summary = this.describePayload(dataPayload, 'in', envelope.senderDeviceName);
      if (summary) {
        this.log('in', envelope.senderDeviceName, summary);
      }

      this.onReceivePayload(dataPayload, {
        peerId: envelope.senderPeerId,
        deviceName: envelope.senderDeviceName,
      });
    }
  }

  private describePayload(
    payload: LanSyncPayload,
    dir: 'in' | 'out',
    peerName: string
  ): string | null {
    const prefix = dir === 'in' ? `Nhận từ ${peerName}:` : 'Đã phát qua LAN:';
    switch (payload.action) {
      case 'sync:full_state': {
        const count = payload.expenses?.length || 0;
        const imgCount = (payload.expenses || []).reduce(
          (acc, it) => acc + (it.images?.length || 0),
          0
        );
        return `${prefix} Đồng bộ toàn bộ ${count} khoản chi (${imgCount} ảnh chứng từ)`;
      }
      case 'sync:expense_upsert': {
        const exp = payload.expense;
        if (!exp) return null;
        const imgCount = exp.images?.length || 0;
        return `${prefix} Khoản chi "${exp.description}" (${exp.amount.toLocaleString('vi-VN')}đ${
          imgCount > 0 ? `, ${imgCount} ảnh` : ''
        })`;
      }
      case 'sync:expenses_bulk_upsert':
        return `${prefix} ${payload.expenses?.length || 0} khoản chi hàng loạt`;
      case 'sync:expense_delete':
        return `${prefix} Xóa 1 khoản chi`;
      case 'sync:expenses_bulk_delete':
        return `${prefix} Xóa ${payload.expenseIds?.length || 0} khoản chi`;
      case 'sync:clear_all':
        return `${prefix} Xóa trắng toàn bộ dữ liệu`;
      case 'sync:advance_upsert':
        return `${prefix} Cập nhật đợt tạm ứng`;
      case 'sync:advance_delete':
        return `${prefix} Xóa đợt tạm ứng`;
      case 'sync:profile_upsert':
        return `${prefix} Cập nhật hồ sơ "${payload.profile?.name || ''}"`;
      case 'sync:profile_delete':
        return `${prefix} Xóa hồ sơ`;
      default:
        return null;
    }
  }

  private async sendSignalEnvelope(opts: {
    kind: SignalEnvelope['kind'];
    targetPeerId?: string;
    payload: any;
  }): Promise<void> {
    if (!this.roomCode) return;
    const envelope: SignalEnvelope = {
      messageId: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      roomCode: this.roomCode,
      senderPeerId: this.peerId,
      senderDeviceName: this.deviceName,
      senderDeviceType: this.deviceType,
      targetPeerId: opts.targetPeerId,
      kind: opts.kind,
      payload: opts.payload,
      timestamp: Date.now(),
    };

    this.processedMessageIds.add(envelope.messageId);

    // 1. Send via local BroadcastChannel if open
    try {
      this.broadcastChannel?.postMessage(envelope);
    } catch {}

    // 2. For data messages, try sending directly over WebRTC P2P DataChannel first
    if (opts.kind === 'data') {
      this.sendOverWebRTCIfOpen(envelope);
    }

    // 3. Also send via Server Relay to guarantee delivery to all peers in the room
    const baseUrl = resolveHubBaseUrl();
    try {
      await fetch(`${baseUrl}/api/lan-sync/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomCode: this.roomCode,
          envelope,
        }),
      });
    } catch (err) {
      console.warn('[LAN Sync] Server relay send warning:', err);
    }
  }

  public async broadcastData(payload: LanSyncPayload): Promise<void> {
    if (!this.roomCode || this.status === 'disconnected') return;
    const summary = this.describePayload(payload, 'out', this.deviceName);
    if (summary && payload.action !== 'sync:request_full') {
      this.log('out', this.deviceName, summary);
    }
    await this.sendSignalEnvelope({
      kind: 'data',
      payload,
    });
  }
}
