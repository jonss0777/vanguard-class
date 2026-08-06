document.addEventListener('DOMContentLoaded', () => {
    // State Variables
    let isHumanPresent = false;
    let isWindowOpen = false;

    // DOM Elements
    const presenceToggle = document.getElementById('presence-sim-toggle');
    const statusCard = document.getElementById('status-card');
    const presenceText = document.getElementById('presence-text');
    const modeBadge = document.getElementById('mode-badge');
    const modeText = document.getElementById('mode-text');
    
    const windowStateBadge = document.getElementById('window-state-badge');
    const windowStatusDesc = document.getElementById('window-status-desc');
    const flapRuleBadge = document.getElementById('flap-rule-badge');
    const flapRuleDesc = document.getElementById('flap-rule-desc');
    
    const simCatWaitingBtn = document.getElementById('sim-cat-waiting-btn');
    const toastNotification = document.getElementById('toast-notification');
    const eventTimeline = document.getElementById('event-timeline');
    const clearLogsBtn = document.getElementById('clear-logs-btn');

    const cameraModal = document.getElementById('camera-modal');
    const toggleCameraBtn = document.getElementById('toggle-camera-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');

    // Initialize System Default State (Absent)
    updateSystemState(false);

    // Event Listener: Human Presence Simulation Toggle
    presenceToggle.addEventListener('change', (e) => {
        isHumanPresent = e.target.checked;
        updateSystemState(isHumanPresent);
    });

    // Master Logic Function
    function updateSystemState(present) {
        if (present) {
            // State A: Human Present
            statusCard.className = 'status-card present';
            presenceText.textContent = 'Human Present in Room';
            
            modeBadge.className = 'mode-badge badge-success';
            modeText.textContent = 'Unrestricted Supervision Mode';

            // Window automatically opens to let cat out/in
            isWindowOpen = true;
            windowStateBadge.className = 'badge badge-success';
            windowStateBadge.textContent = 'Open';
            windowStatusDesc.textContent = 'Window opened automatically for full indoor/outdoor access.';

            flapRuleBadge.className = 'badge badge-success';
            flapRuleBadge.textContent = 'Two-Way Access';
            flapRuleDesc.textContent = 'Cat can freely exit or enter while supervised.';

            logEvent('Presence Detected', 'Human entered room. Window opened automatically.');
        } else {
            // State B: Human Absent
            statusCard.className = 'status-card absent';
            presenceText.textContent = 'No Human Present';

            modeBadge.className = 'mode-badge badge-info';
            modeText.textContent = 'Secured / Inbound Only Mode';

            // Window locks shut; flap restricts exit
            isWindowOpen = false;
            windowStateBadge.className = 'badge badge-danger';
            windowStateBadge.textContent = 'Locked';
            windowStatusDesc.textContent = 'Window locked shut to prevent unsupervised exit or pest entry.';

            flapRuleBadge.className = 'badge badge-info';
            flapRuleBadge.textContent = 'Inbound Only';
            flapRuleDesc.textContent = 'Cat can enter from outside, but exits are locked.';

            logEvent('Presence Cleared', 'Room empty. Window locked; door set to inbound-only.');
        }
    }

    // Trigger Notification: Cat Waiting Outside
    simCatWaitingBtn.addEventListener('click', () => {
        showToast('Cat Detected Outside', 'Your cat is outside the window requesting entry.');
        logEvent('Cat Waiting', 'Outdoor camera detected cat at the window.');

        // If cat enters while room is unmonitored
        if (!isHumanPresent) {
            setTimeout(() => {
                logEvent('Cat Entered', 'Cat entered through inbound-only door flap. Exit remains locked.');
            }, 3000);
        }
    });

    // Helper: Toast Notification
    function showToast(title, message) {
        document.getElementById('toast-title').textContent = title;
        document.getElementById('toast-message').textContent = message;
        toastNotification.classList.add('active');

        setTimeout(() => {
            toastNotification.classList.remove('active');
        }, 4000);
    }

    // Helper: Event Logger
    function logEvent(title, detail) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

    // Clear Logs
    clearLogsBtn.addEventListener('click', () => {
        eventTimeline.innerHTML = '';
    });

    // Camera Modal Handlers
    toggleCameraBtn.addEventListener('click', () => cameraModal.classList.add('active'));
    closeModalBtn.addEventListener('click', () => cameraModal.classList.remove('active'));
    cameraModal.addEventListener('click', (e) => {
        if (e.target === cameraModal) cameraModal.classList.remove('active');
    });
});