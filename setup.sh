#!/bin/bash
# ============================================================
# setup.sh — Nightwing Robot Interface Setup (Updated)
# Supports: ESP32 via UART + SG90 Servo
# Run as: bash setup.sh
# ============================================================
set -e

echo "================================================="
echo " Nightwing Robot Interface — Setup Script"
echo "================================================="

# --- System Update ---
echo "[1/8] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# --- System Dependencies ---
echo "[2/8] Installing system dependencies..."
sudo apt install -y \
    python3 python3-pip python3-venv \
    python3-picamera2 \
    libcamera-apps \
    libopus-dev libvpx-dev \
    nginx \
    git \
    ffmpeg

# --- Enable Camera Interface ---
echo "[3/8] Enabling Camera interface..."
sudo raspi-config nonint do_camera 0

# --- Disable Bluetooth to free up full UART (ttyAMA0) ---
# Pi GPIO14/15 uses ttyAMA0 (full UART) when BT is disabled
echo "[4/8] Disabling Bluetooth to free UART on GPIO14/15..."
sudo systemctl disable hciuart 2>/dev/null || true
sudo systemctl stop    hciuart 2>/dev/null || true

# Add to /boot/config.txt if not already present
if ! grep -q "dtoverlay=disable-bt" /boot/config.txt; then
    echo "dtoverlay=disable-bt" | sudo tee -a /boot/config.txt
fi
if ! grep -q "enable_uart=1" /boot/config.txt; then
    echo "enable_uart=1" | sudo tee -a /boot/config.txt
fi

# Disable serial login shell (so ttyAMA0 is free for our use)
sudo raspi-config nonint do_serial_hw 0   # Enable UART hardware
sudo raspi-config nonint do_serial_cons 1 # Disable console on serial

# --- Virtual Environment ---
echo "[5/8] Setting up Python virtual environment..."
python3 -m venv venv --system-site-packages
source venv/bin/activate

# --- Python Packages ---
echo "[6/8] Installing Python packages..."
pip install --upgrade pip
pip install -r requirements.txt

# --- Runtime Directories ---
echo "[7/8] Creating runtime directories..."
mkdir -p recordings logs backend frontend esp32_firmware

# --- Nginx Config ---
echo "[8/8] Configuring Nginx..."
sudo cp nginx.conf /etc/nginx/sites-available/nightwing
sudo ln -sf /etc/nginx/sites-available/nightwing /etc/nginx/sites-enabled/nightwing
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# --- Systemd Service ---
echo "[*] Installing systemd service..."
sudo cp robot-interface.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable robot-interface.service
sudo systemctl start robot-interface.service

echo ""
echo "================================================="
echo " Setup Complete!"
echo " NOTE: A REBOOT is required for UART changes."
echo " Run: sudo reboot"
echo ""
echo " After reboot, access at:"
echo "   http://$(hostname -I | awk '{print $1}')"
echo "================================================="
