import cv2
import subprocess
import requests
import time
from ultralytics import YOLO

SUPABASE_URL = ""
SUPABASE_KEY = ""

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"  # Standard REST preference for 204 response handling
}

# Cooldown timing to avoid database spamming
last_alert_time = 0
ALERT_COOLDOWN = 10  # Seconds between notifications

def notify_detections(detections):
    """
    Sends a combined event to Supabase if any relevant class (human, dog, cat) is detected.
    
    :param detections: dict mapping class name to confidence, 
                       e.g. {"cat": 0.92, "human": 0.85} or [("cat", 0.92), ("dog", 0.78)]
    """
    global last_alert_time
    current_time = time.time()

    # Normalize class labels (YOLO maps person -> human if needed)
    target_classes = {"cat", "dog", "human", "person"}
    if isinstance(detections, list):
        detections = dict(detections)
        
    active_detections = {}
    for cls, conf in detections.items():
        cls_lower = cls.lower()
        if cls_lower in target_classes:
            # Map COCO 'person' to 'human' for clean data representation
            normalized_cls = "human" if cls_lower == "person" else cls_lower
            active_detections[normalized_cls] = max(active_detections.get(normalized_cls, 0.0), conf)

    if not active_detections:
        return

    if current_time - last_alert_time > ALERT_COOLDOWN:
        # Build composite strings
        detected_types = list(active_detections.keys())
        event_type = "_".join(sorted(detected_types)) + "_detected"
        
        details = [f"{cls.capitalize()} ({conf * 100:.0f}%)" for cls, conf in active_detections.items()]
        message = f"Detected: {', '.join(details)}"
        
        # Max confidence among active detections for primary payload field
        max_confidence = max(active_detections.values())

        data = {
            "event_type": event_type,
            "message": message,
            "confidence": round(float(max_confidence), 2),
            "status": "waiting_outside",
            "detections": active_detections  # Includes exact breakdown in JSON
        }

        try:
            response = requests.post(
                f"{SUPABASE_URL}/rest/v1/events", 
                json=data, 
                headers=headers, 
                timeout=5
            )
            if response.status_code in [200, 201, 204]:
                print(f"[INFO] Event sent to Supabase: {message}")
                last_alert_time = current_time
            else:
                print(f"[WARNING] Supabase API status {response.status_code}: {response.text}")
        except Exception as e:
            print(f"[ERROR] Failed to send event to Supabase: {e}")


# Load YOLOv8 Nano model
model = YOLO('yolov8n.pt')

# COCO Target Classes: 15 = Cat, 16 = Dog, 0 = Person
TARGET_CLASSES = [15, 16, 0]

# Video & Stream Configuration
WIDTH, HEIGHT, FPS = 1280, 720, 30
RTSP_URL = ""

# FFmpeg process output pipeline
ffmpeg_cmd = [
    'ffmpeg',
    '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-pix_fmt', 'bgr24',
    '-s', f'{WIDTH}x{HEIGHT}',
    '-r', str(FPS),
    '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-f', 'rtsp',
    RTSP_URL
]

ffmpeg_process = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)

# Open hardware video device
cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
cap.set(cv2.CAP_PROP_FPS, FPS)

print("[INFO] Object detection and RTSP streaming active...")

try:
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            print("[WARNING] Failed to grab frame from camera.")
            break

        # Run detection inference
        results = model(frame, conf=0.5, verbose=False)[0]

        # Dictionary to accumulate highest confidence per target class in current frame
        frame_detections = {}

        for box in results.boxes:
            cls_id = int(box.cls[0])
            if cls_id in TARGET_CLASSES:
                label = model.names[cls_id]
                confidence = float(box.conf[0])

                # Store maximum confidence score per detected class in frame
                if label not in frame_detections or confidence > frame_detections[label]:
                    frame_detections[label] = confidence

                # Bounding box rendering
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(frame, f"{label} {confidence:.2f}", (x1, max(y1 - 10, 15)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

        # Trigger notification if any target class was detected
        if frame_detections:
            notify_detections(frame_detections)

        # Write processed frame to RTSP stream pipe safely
        try:
            ffmpeg_process.stdin.write(frame.tobytes())
        except (BrokenPipeError, IOError):
            print("[ERROR] FFmpeg pipeline broken. Stopping stream.")
            break

except KeyboardInterrupt:
    print("[INFO] Manual shutdown initiated...")
finally:
    cap.release()
    if ffmpeg_process.stdin:
        ffmpeg_process.stdin.close()
    ffmpeg_process.wait()
    print("[INFO] Video stream and camera released successfully.")
