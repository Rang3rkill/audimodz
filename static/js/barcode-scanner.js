/**
 * Barcode Scanner Module - Optimized for Slim Barcodes on Yellow Tags
 * Uses QuaggaJS with enhanced settings for narrow barcode detection
 */

const BarcodeScanner = {
    // State
    isScanning: false,
    isInitialized: false,
    lastDetectedCode: null,
    detectionBuffer: [],
    bufferSize: 5,           // Number of consistent reads required
    minConfidence: 0.7,      // Minimum confidence threshold
    debounceMs: 100,         // Debounce between processing frames
    lastProcessTime: 0,
    scanCallback: null,
    errorCallback: null,

    // Scanner configuration optimized for slim barcodes
    config: {
        inputStream: {
            name: "Live",
            type: "LiveStream",
            target: null, // Set during init
            constraints: {
                facingMode: "environment",
                width: { min: 1280, ideal: 1920, max: 2560 },
                height: { min: 720, ideal: 1080, max: 1440 },
                aspectRatio: { min: 1, max: 2 },
                // Request high resolution for slim barcode detection
                advanced: [
                    { focusMode: "continuous" },
                    { exposureMode: "continuous" },
                    { whiteBalanceMode: "continuous" }
                ]
            }
        },
        locator: {
            // Increased patch size for better slim barcode detection
            patchSize: "medium",
            halfSample: false, // Full resolution for thin lines
            debug: {
                showCanvas: false,
                showPatches: false,
                showFoundPatches: false,
                showSkeleton: false,
                showLabels: false,
                showPatchLabels: false,
                showRemainingPatchLabels: false
            }
        },
        numOfWorkers: navigator.hardwareConcurrency || 4,
        frequency: 15, // Higher frequency for rapid scanning
        decoder: {
            readers: [
                // Prioritize formats common on retail tags
                "ean_reader",           // EAN-13 (most retail)
                "ean_8_reader",         // EAN-8
                "upc_reader",           // UPC-A
                "upc_e_reader",         // UPC-E (compact)
                "code_128_reader",      // Code 128
                "code_39_reader",       // Code 39
                "code_93_reader",       // Code 93
                "codabar_reader",       // Codabar
                "i2of5_reader"          // Interleaved 2 of 5
            ],
            multiple: false,
            debug: {
                drawBoundingBox: true,
                showFrequency: false,
                drawScanline: true,
                showPattern: false
            }
        },
        locate: true
    },

    /**
     * Initialize the scanner
     * @param {HTMLElement} targetElement - Container for camera feed
     * @param {Function} onScan - Callback when barcode detected
     * @param {Function} onError - Callback on error
     */
    async init(targetElement, onScan, onError) {
        if (typeof Quagga === 'undefined') {
            const error = 'QuaggaJS library not loaded';
            console.error(error);
            if (onError) onError(error);
            return false;
        }

        this.scanCallback = onScan;
        this.errorCallback = onError;
        this.config.inputStream.target = targetElement;

        // Reset state
        this.detectionBuffer = [];
        this.lastDetectedCode = null;
        this.lastProcessTime = 0;

        return new Promise((resolve, reject) => {
            Quagga.init(this.config, (err) => {
                if (err) {
                    console.error('Scanner init error:', err);
                    if (this.errorCallback) this.errorCallback(err);
                    reject(err);
                    return;
                }

                this.isInitialized = true;
                this.setupDetectionHandler();
                this.setupProcessingHandler();
                resolve(true);
            });
        });
    },

    /**
     * Set up the main detection handler with validation
     */
    setupDetectionHandler() {
        Quagga.onDetected((result) => {
            const now = Date.now();

            // Debounce rapid detections
            if (now - this.lastProcessTime < this.debounceMs) {
                return;
            }
            this.lastProcessTime = now;

            if (!result || !result.codeResult) return;

            const code = result.codeResult.code;
            const format = result.codeResult.format;

            // Calculate confidence from error correction
            const confidence = this.calculateConfidence(result);

            console.log(`Detected: ${code} (${format}) - Confidence: ${(confidence * 100).toFixed(1)}%`);

            // Skip low confidence reads
            if (confidence < this.minConfidence) {
                console.log('Low confidence, skipping...');
                this.updateStatus(`Low confidence read: ${code}`, 'warning');
                return;
            }

            // Add to buffer for validation
            this.addToBuffer(code, format, confidence);

            // Check if we have enough consistent reads
            const validatedCode = this.validateBuffer();
            if (validatedCode) {
                console.log(`Validated barcode: ${validatedCode.code}`);
                this.handleValidatedScan(validatedCode);
            }
        });
    },

    /**
     * Set up processing handler for visual feedback
     */
    setupProcessingHandler() {
        Quagga.onProcessed((result) => {
            const drawingCtx = Quagga.canvas.ctx.overlay;
            const drawingCanvas = Quagga.canvas.dom.overlay;

            if (!drawingCtx || !drawingCanvas) return;

            // Clear previous drawings
            drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);

            if (result) {
                // Draw scan area guide
                this.drawScanGuide(drawingCtx, drawingCanvas);

                // Draw detected boxes
                if (result.boxes) {
                    result.boxes.filter(box => box !== result.box).forEach(box => {
                        Quagga.ImageDebug.drawPath(box, { x: 0, y: 1 }, drawingCtx, {
                            color: "rgba(59, 130, 246, 0.5)",
                            lineWidth: 2
                        });
                    });
                }

                // Draw main detection box
                if (result.box) {
                    Quagga.ImageDebug.drawPath(result.box, { x: 0, y: 1 }, drawingCtx, {
                        color: "#22c55e",
                        lineWidth: 3
                    });
                }

                // Draw scan line
                if (result.codeResult && result.codeResult.code) {
                    Quagga.ImageDebug.drawPath(result.line, { x: 'x', y: 'y' }, drawingCtx, {
                        color: '#ef4444',
                        lineWidth: 3
                    });
                }
            }
        });
    },

    /**
     * Draw scan guide overlay
     */
    drawScanGuide(ctx, canvas) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const guideWidth = canvas.width * 0.8;
        const guideHeight = 100;

        // Draw scan zone indicator
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 5]);
        ctx.strokeRect(
            centerX - guideWidth / 2,
            centerY - guideHeight / 2,
            guideWidth,
            guideHeight
        );
        ctx.setLineDash([]);

        // Draw corner markers
        const cornerSize = 20;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 4;

        // Top-left
        ctx.beginPath();
        ctx.moveTo(centerX - guideWidth / 2, centerY - guideHeight / 2 + cornerSize);
        ctx.lineTo(centerX - guideWidth / 2, centerY - guideHeight / 2);
        ctx.lineTo(centerX - guideWidth / 2 + cornerSize, centerY - guideHeight / 2);
        ctx.stroke();

        // Top-right
        ctx.beginPath();
        ctx.moveTo(centerX + guideWidth / 2 - cornerSize, centerY - guideHeight / 2);
        ctx.lineTo(centerX + guideWidth / 2, centerY - guideHeight / 2);
        ctx.lineTo(centerX + guideWidth / 2, centerY - guideHeight / 2 + cornerSize);
        ctx.stroke();

        // Bottom-left
        ctx.beginPath();
        ctx.moveTo(centerX - guideWidth / 2, centerY + guideHeight / 2 - cornerSize);
        ctx.lineTo(centerX - guideWidth / 2, centerY + guideHeight / 2);
        ctx.lineTo(centerX - guideWidth / 2 + cornerSize, centerY + guideHeight / 2);
        ctx.stroke();

        // Bottom-right
        ctx.beginPath();
        ctx.moveTo(centerX + guideWidth / 2 - cornerSize, centerY + guideHeight / 2);
        ctx.lineTo(centerX + guideWidth / 2, centerY + guideHeight / 2);
        ctx.lineTo(centerX + guideWidth / 2, centerY + guideHeight / 2 - cornerSize);
        ctx.stroke();
    },

    /**
     * Calculate confidence score for a detection
     */
    calculateConfidence(result) {
        if (!result.codeResult) return 0;

        // Start with base confidence
        let confidence = 0.5;

        // Factor in decodedCodes error rates
        if (result.codeResult.decodedCodes) {
            const codes = result.codeResult.decodedCodes;
            let totalError = 0;
            let validCodes = 0;

            codes.forEach(code => {
                if (code.error !== undefined && code.error !== null) {
                    totalError += code.error;
                    validCodes++;
                }
            });

            if (validCodes > 0) {
                const avgError = totalError / validCodes;
                // Lower error = higher confidence
                confidence = Math.max(0, 1 - avgError);
            }
        }

        // Bonus for checksum validation (EAN/UPC codes)
        if (result.codeResult.format &&
            (result.codeResult.format.includes('ean') ||
             result.codeResult.format.includes('upc'))) {
            if (this.validateChecksum(result.codeResult.code, result.codeResult.format)) {
                confidence = Math.min(1, confidence + 0.2);
            }
        }

        return confidence;
    },

    /**
     * Validate checksum for EAN/UPC codes
     */
    validateChecksum(code, format) {
        if (!code) return false;

        try {
            if (format === 'ean_13' || format === 'ean_reader') {
                return this.validateEAN13(code);
            } else if (format === 'ean_8' || format === 'ean_8_reader') {
                return this.validateEAN8(code);
            } else if (format === 'upc_a' || format === 'upc_reader') {
                return this.validateUPCA(code);
            }
        } catch (e) {
            return false;
        }
        return true; // Assume valid for other formats
    },

    validateEAN13(code) {
        if (code.length !== 13) return false;
        let sum = 0;
        for (let i = 0; i < 12; i++) {
            sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
        }
        const checkDigit = (10 - (sum % 10)) % 10;
        return checkDigit === parseInt(code[12]);
    },

    validateEAN8(code) {
        if (code.length !== 8) return false;
        let sum = 0;
        for (let i = 0; i < 7; i++) {
            sum += parseInt(code[i]) * (i % 2 === 0 ? 3 : 1);
        }
        const checkDigit = (10 - (sum % 10)) % 10;
        return checkDigit === parseInt(code[7]);
    },

    validateUPCA(code) {
        if (code.length !== 12) return false;
        let sum = 0;
        for (let i = 0; i < 11; i++) {
            sum += parseInt(code[i]) * (i % 2 === 0 ? 3 : 1);
        }
        const checkDigit = (10 - (sum % 10)) % 10;
        return checkDigit === parseInt(code[11]);
    },

    /**
     * Add detection to buffer for multi-read validation
     */
    addToBuffer(code, format, confidence) {
        const now = Date.now();

        // Remove old entries (older than 2 seconds)
        this.detectionBuffer = this.detectionBuffer.filter(
            entry => now - entry.timestamp < 2000
        );

        // Add new entry
        this.detectionBuffer.push({
            code,
            format,
            confidence,
            timestamp: now
        });

        // Update visual feedback
        const matchCount = this.detectionBuffer.filter(e => e.code === code).length;
        this.updateStatus(`Reading: ${code} (${matchCount}/${this.bufferSize})`, 'reading');
    },

    /**
     * Validate buffer - check for consistent reads
     */
    validateBuffer() {
        if (this.detectionBuffer.length < this.bufferSize) return null;

        // Group by code
        const codeCounts = {};
        this.detectionBuffer.forEach(entry => {
            if (!codeCounts[entry.code]) {
                codeCounts[entry.code] = {
                    count: 0,
                    totalConfidence: 0,
                    format: entry.format
                };
            }
            codeCounts[entry.code].count++;
            codeCounts[entry.code].totalConfidence += entry.confidence;
        });

        // Find code with enough consistent reads
        for (const [code, data] of Object.entries(codeCounts)) {
            if (data.count >= this.bufferSize) {
                const avgConfidence = data.totalConfidence / data.count;
                if (avgConfidence >= this.minConfidence) {
                    return {
                        code,
                        format: data.format,
                        confidence: avgConfidence
                    };
                }
            }
        }

        return null;
    },

    /**
     * Handle validated scan result
     */
    handleValidatedScan(result) {
        // Prevent duplicate rapid callbacks
        if (this.lastDetectedCode === result.code) {
            const timeSinceLastScan = Date.now() - this.lastScanTime;
            if (timeSinceLastScan < 3000) {
                return;
            }
        }

        this.lastDetectedCode = result.code;
        this.lastScanTime = Date.now();
        this.detectionBuffer = []; // Clear buffer

        // Visual feedback
        this.showSuccess(result.code);

        // Play success sound
        this.playBeep();

        // Vibrate if supported
        if (navigator.vibrate) {
            navigator.vibrate(200);
        }

        // Call callback
        if (this.scanCallback) {
            this.scanCallback(result);
        }
    },

    /**
     * Update status display
     */
    updateStatus(message, type) {
        const statusEl = document.getElementById('scannerStatus');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.className = `scanner-status scanner-status-${type}`;
        }
    },

    /**
     * Show success feedback
     */
    showSuccess(code) {
        this.updateStatus(`Scanned: ${code}`, 'success');

        const viewport = document.getElementById('scannerViewport');
        if (viewport) {
            viewport.classList.add('scan-success');
            setTimeout(() => viewport.classList.remove('scan-success'), 500);
        }
    },

    /**
     * Play beep sound on successful scan
     */
    playBeep() {
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.frequency.value = 1800;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.3;

            oscillator.start();
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
            oscillator.stop(audioCtx.currentTime + 0.15);
        } catch (e) {
            // Audio not supported, ignore
        }
    },

    /**
     * Start scanning
     */
    start() {
        if (!this.isInitialized) {
            console.error('Scanner not initialized');
            return;
        }
        Quagga.start();
        this.isScanning = true;
        this.updateStatus('Point camera at barcode', 'info');
    },

    /**
     * Stop scanning
     */
    stop() {
        if (this.isInitialized) {
            Quagga.stop();
        }
        this.isScanning = false;
        this.detectionBuffer = [];
    },

    /**
     * Destroy scanner instance
     */
    destroy() {
        this.stop();
        if (this.isInitialized) {
            Quagga.offDetected();
            Quagga.offProcessed();
        }
        this.isInitialized = false;
    },

    /**
     * Switch camera (front/back)
     */
    async switchCamera() {
        const currentFacing = this.config.inputStream.constraints.facingMode;
        this.config.inputStream.constraints.facingMode =
            currentFacing === 'environment' ? 'user' : 'environment';

        this.stop();
        this.destroy();

        const targetEl = this.config.inputStream.target;
        await this.init(targetEl, this.scanCallback, this.errorCallback);
        this.start();
    },

    /**
     * Adjust settings for slim barcodes
     */
    optimizeForSlimBarcodes() {
        // Increase buffer for more consistent reads
        this.bufferSize = 6;
        this.minConfidence = 0.65;
        this.debounceMs = 80;

        console.log('Optimized for slim barcodes');
    },

    /**
     * Reset to default settings
     */
    resetSettings() {
        this.bufferSize = 5;
        this.minConfidence = 0.7;
        this.debounceMs = 100;
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = BarcodeScanner;
}
