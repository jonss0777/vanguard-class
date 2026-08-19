import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://fqvpzvwlkxdeqqkqkjnh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_umgBNG0VuXTNTZAA9qfYbA_-wGYCeSk';
export const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const WEBRTC_URL = 'http://3.82.112.245:8889/mystream/whep';
let peerConnection = null;

// Track current states
let currentWindowState = 'locked';       // 'locked' | 'unlocked'
let currentFlapRule = 'inbound_only';    // 'inbound_only' | 'outbound_only' | 'two_way'

// Initialize Supabase Listeners & Data Fetch
async function initSupabase() {
    try {
        const { data, error } = await db
            .from('system_config')
            .select('*')
            .eq('id', 1)
            .single();

        if (!error && data) {
            currentWindowState = data.window_state;
            currentFlapRule = data.flap_rule;
            renderUI();
        }
    } catch (err) {
        console.error("Failed to fetch system_config:", err);
    }

    try {
        const { data: initialEvents, error: eventsErr } = await db
            .from('events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        if (!eventsErr && initialEvents) {
            initialEvents.reverse().forEach(event => handleDetectionEvent(event, false));
        }
    } catch (err) {
        console.error("Failed to fetch initial events:", err);
    }

    db.channel('config_updates')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'system_config', filter: 'id=eq.1' },
            (payload) => {
                if (payload.new) {
                    currentWindowState = payload.new.window_state;
                    currentFlapRule = payload.new.flap_rule;
                    renderUI();
                    logEvent('Config Updated', `Window: ${currentWindowState.toUpperCase()} | Flap: ${currentFlapRule.toUpperCase()}`);
                }
            }
        )
        .subscribe();

    db.channel('detection_alerts')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'events' },
            (payload) => {
                handleDetectionEvent(payload.new, true);
            }
        )
        .subscribe();
}

function handleDetectionEvent(newEvent, triggerToast = true) {
    const eventType = (newEvent.event_type || '').toLowerCase();
    const message = newEvent.message || 'Detection trigger received.';

    const hasHuman = eventType.includes('human') || eventType.includes('person');
    const hasCat = eventType.includes('cat');
    const hasDog = eventType.includes('dog');

    let title = "Entity Detected";
    let iconClass = "fa-bell";

    if (hasCat && hasDog && hasHuman) {
        title = "Cat, Dog & Human Detected!";
        iconClass = "fa-users-viewfinder";
    } else if (hasCat && hasDog) {
        title = "Cat & Dog Detected!";
        iconClass = "fa-shield-dog";
    } else if (hasCat && hasHuman) {
        title = "Cat & Human Detected!";
        iconClass = "fa-person-shelter";
    } else if (hasDog && hasHuman) {
        title = "Dog & Human Detected!";
        iconClass = "fa-person-walking-with-dog";
    } else if (hasCat) {
        title = "Cat Detected!";
        iconClass = "fa-cat";
    } else if (hasDog) {
        title = "Dog Detected!";
        iconClass = "fa-dog";
    } else if (hasHuman) {
        title = "Human Detected!";
        iconClass = "fa-user";
    }

    logEvent(title, message, newEvent.created_at);

    if (triggerToast) {
        showToast(title, message, iconClass);
    }
}

async function pushConfigToSupabase(newWindowState, newFlapRule) {
    try {
        const { error } = await db
            .from('system_config')
            .update({ 
                window_state: newWindowState, 
                flap_rule: newFlapRule,
                updated_at: new Date().toISOString()
            })
            .eq('id', 1);

        if (error) {
            console.error("Failed to write system_config:", error);
            showToast("Error", "Could not update state in Supabase.", "fa-triangle-exclamation");
        } else {
            currentWindowState = newWindowState;
            currentFlapRule = newFlapRule;
            renderUI();
            showToast("State Saved", `Window: ${newWindowState} | Rule: ${newFlapRule}`, "fa-database");
        }
    } catch (err) {
        console.error("Error updating system_config:", err);
    }
}

function renderUI() {
    const windowBadge = document.getElementById('window-state-badge');
    const windowDesc = document.getElementById('window-status-desc');
    const windowBtnIcon = document.getElementById('window-btn-icon');
    const windowBtnText = document.getElementById('window-btn-text');

    const flapBadge = document.getElementById('flap-rule-badge');
    const flapDesc = document.getElementById('flap-rule-desc');
    const flapBtnIcon = document.getElementById('flap-btn-icon');
    const flapBtnText = document.getElementById('flap-btn-text');

    if (windowBtnIcon) windowBtnIcon.className = 'fa-solid fa-power-off';
    if (flapBtnIcon) flapBtnIcon.className = 'fa-solid fa-sliders';

    if (currentWindowState === 'unlocked') {
        if (windowBadge) { windowBadge.className = 'badge badge-success'; windowBadge.textContent = 'Unlocked'; }
        if (windowDesc) windowDesc.textContent = 'Window unlocked.';
        if (windowBtnText) windowBtnText.textContent = 'Lock Window';
    } else {
        if (windowBadge) { windowBadge.className = 'badge badge-danger'; windowBadge.textContent = 'Locked'; }
        if (windowDesc) windowDesc.textContent = 'Window locked shut.';
        if (windowBtnText) windowBtnText.textContent = 'Unlock Window';
    }

    if (flapBadge && flapDesc) {
        if (currentFlapRule === 'two_way') {
            flapBadge.className = 'badge badge-success';
            flapBadge.textContent = 'Two-Way Access';
            flapDesc.textContent = 'Inbound & Outbound rules active.';
            if (flapBtnText) flapBtnText.textContent = 'Set Inbound Only';
        } else if (currentFlapRule === 'outbound_only') {
            flapBadge.className = 'badge badge-warning';
            flapBadge.textContent = 'Outbound Only';
            flapDesc.textContent = 'Pets can exit, but inbound access is locked.';
            if (flapBtnText) flapBtnText.textContent = 'Set Two-Way Access';
        } else {
            flapBadge.className = 'badge badge-info';
            flapBadge.textContent = 'Inbound Only';
            flapDesc.textContent = 'Pets can enter, but outbound exit is locked.';
            if (flapBtnText) flapBtnText.textContent = 'Set Outbound Only';
        }
    }
}

function showToast(title, message, iconClass = 'fa-bell') {
    const toast = document.getElementById('toast-notification');
    const toastTitle = document.getElementById('toast-title');
    const toastMsg = document.getElementById('toast-message');
    const toastIcon = document.getElementById('toast-icon');

    if (toast) {
        if (toastIcon) toastIcon.className = `fa-solid ${iconClass} toast-icon`;
        if (toastTitle) toastTitle.innerText = title;
        if (toastMsg) toastMsg.innerText = message;
        toast.classList.add('active', 'show');

        setTimeout(() => toast.classList.remove('active', 'show'), 4000);
    }
}

function logEvent(title, detail, timestamp = null) {
    const eventTimeline = document.getElementById('event-timeline');
    if (!eventTimeline) return;

    const dateObj = timestamp ? new Date(timestamp) : new Date();
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const item = document.createElement('div');
    item.className = 'timeline-item';
    item.innerHTML = `
        <span class="timeline-time">${timeStr}</span>
        <div class="timeline-content">
            <strong>${title}</strong> — ${detail}
        </div>
    `;
    eventTimeline.prepend(item);
}

// Fixed WebRTC Stream Handler
async function startWebRTCStream() {
    const videoEl = document.getElementById('webrtc-video');
    const cameraStatusText = document.getElementById('camera-status-text');
    const reconnectIcon = document.getElementById('reconnect-icon');

    if (!videoEl) return;
    if (cameraStatusText) cameraStatusText.innerText = "Connecting to live feed...";
    if (reconnectIcon) reconnectIcon.classList.add('fa-spin');

    // Ensure Video Element is explicitly muted (Browsers block autoplay otherwise)
    videoEl.muted = true;

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }

    peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Handle Incoming Tracks
    peerConnection.ontrack = (event) => {
        console.log("WebRTC track received:", event.track.kind);
        if (event.streams && event.streams[0]) {
            videoEl.srcObject = event.streams[0];
        } else {
            const inboundStream = new MediaStream([event.track]);
            videoEl.srcObject = inboundStream;
        }

        // Force browser play
        videoEl.play().then(() => {
            if (cameraStatusText) cameraStatusText.innerText = "Live Stream Connected.";
            if (reconnectIcon) reconnectIcon.classList.remove('fa-spin');
        }).catch(err => {
            console.error("Autoplay play() error:", err);
            if (cameraStatusText) cameraStatusText.innerText = "Click video player to unblock video autoplay.";
        });
    };

    try {
        peerConnection.addTransceiver('video', { direction: 'recvonly' });
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        // Wait for ICE gathering to complete or timeout after 2 seconds
        await Promise.race([
            new Promise(resolve => {
                if (peerConnection.iceGatheringState === 'complete') resolve();
                else {
                    const check = () => {
                        if (peerConnection.iceGatheringState === 'complete') {
                            peerConnection.removeEventListener('icegatheringstatechange', check);
                            resolve();
                        }
                    };
                    peerConnection.addEventListener('icegatheringstatechange', check);
                }
            }),
            new Promise(resolve => setTimeout(resolve, 2000))
        ]);

        const response = await fetch(WEBRTC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: peerConnection.localDescription.sdp
        });

        if (!response.ok) {
            throw new Error(`MediaMTX responded with HTTP status ${response.status}`);
        }

        const answerSdp = await response.text();
        await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));

    } catch (err) {
        console.error('WebRTC streaming failed:', err);
        if (cameraStatusText) cameraStatusText.innerText = `Stream Error: ${err.message}`;
        if (reconnectIcon) reconnectIcon.classList.remove('fa-spin');
    }
}

// DOM Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    initSupabase();

    // Start Stream
    startWebRTCStream();

    // User interaction click to unblock autoplay if needed
    const videoEl = document.getElementById('webrtc-video');
    if (videoEl) {
        videoEl.addEventListener('click', () => {
            videoEl.play();
        });
    }

    const reconnectStreamBtn = document.getElementById('reconnect-stream-btn');
    if (reconnectStreamBtn) {
        reconnectStreamBtn.addEventListener('click', () => {
            startWebRTCStream();
            showToast("Video Feed", "Reconnecting to live camera stream...", "fa-rotate-right");
        });
    }

    const toggleWindowBtn = document.getElementById('toggle-window-btn');
    if (toggleWindowBtn) {
        toggleWindowBtn.addEventListener('click', () => {
            const nextWindowState = (currentWindowState === 'locked') ? 'unlocked' : 'locked';
            pushConfigToSupabase(nextWindowState, currentFlapRule);
        });
    }

    const toggleFlapBtn = document.getElementById('toggle-flap-btn');
    if (toggleFlapBtn) {
        toggleFlapBtn.addEventListener('click', () => {
            let nextRule = 'inbound_only';
            if (currentFlapRule === 'inbound_only') nextRule = 'outbound_only';
            else if (currentFlapRule === 'outbound_only') nextRule = 'two_way';
            else nextRule = 'inbound_only';

            pushConfigToSupabase(currentWindowState, nextRule);
        });
    }

    const clearLogsBtn = document.getElementById('clear-logs-btn');
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            const eventTimeline = document.getElementById('event-timeline');
            if (eventTimeline) eventTimeline.innerHTML = '';
        });
    }
});