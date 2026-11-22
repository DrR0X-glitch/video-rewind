"use client";

import { useEffect, useRef, useState } from "react";

type UpcEanScannerProps = {
  onDetected: (value: string) => void;
};

export function UpcEanScanner({ onDetected }: UpcEanScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    if (!scanning || !videoRef.current) return;

    let stopped = false;
    let stopScanning: (() => void) | undefined;

    async function startScanner() {
      try {
        const { BarcodeFormat, BrowserMultiFormatOneDReader } = await import("@zxing/browser");
        if (stopped || !videoRef.current) return;

        const reader = new BrowserMultiFormatOneDReader();
        reader.possibleFormats = [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ];

        setMessage("Point the camera at a UPC or EAN barcode.");
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            const value = result?.getText();
            if (!value) return;
            onDetectedRef.current(value);
            setMessage(`Scanned ${value}`);
            setScanning(false);
          },
        );

        if (stopped) {
          controls.stop();
          return;
        }

        stopScanning = controls.stop;
      } catch {
        setMessage("Camera access failed. Check browser permission or enter the barcode manually.");
        setScanning(false);
      }
    }

    void startScanner();
    return () => {
      stopped = true;
      stopScanning?.();
    };
  }, [scanning]);

  return (
    <div className="barcode-scanner">
      {scanning ? <video ref={videoRef} className="barcode-camera" muted playsInline /> : null}
      <div className="utility-row">
        <button
          type="button"
          onClick={() => {
            setMessage("");
            setScanning((current) => !current);
          }}
        >
          {scanning ? "Stop camera" : "Scan with camera"}
        </button>
        {message ? (
          <span role="status" className="muted">
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
