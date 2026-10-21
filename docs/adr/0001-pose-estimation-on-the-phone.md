# Pose estimation runs on the phone; only landmarks leave the device

The Fire TV has no camera, so a phone is the camera. We run MediaPipe Pose Landmarker and the rep/fault logic (`pose-reps`) in the phone browser and send only landmark coordinates and events — never video — to the cloud and the TV. This keeps bandwidth tiny (~33 points × 15 fps), keeps latency independent of cloud vision services, and gives a concrete privacy guarantee. Rejected: streaming video to the cloud (Rekognition/SageMaker) — costlier, slower, and a privacy liability in a living room.
