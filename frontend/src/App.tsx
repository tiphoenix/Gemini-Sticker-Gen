import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import ReactCrop, { type Crop } from 'react-image-crop';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Download, Scissors, RefreshCw, Wand2 } from 'lucide-react';
import './index.css';

const App: React.FC = () => {
  const [srcImage, setSrcImage] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [margin, setMargin] = useState(5); // Now in mm
  const [alphaThreshold, setAlphaThreshold] = useState(20);
  const [isTransparent, setIsTransparent] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const [logs, setLogs] = useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles && acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      addLog(`File dropped: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
      const reader = new FileReader();
      reader.addEventListener('load', () => setSrcImage(reader.result?.toString() || null));
      reader.readAsDataURL(file);
      setProcessedImage(null);
      setCrop(undefined);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false
  });

  const getCroppedImg = (): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const image = imgRef.current;
      if (!image) return reject('No image');

      const canvas = document.createElement('canvas');
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      const cropW = crop?.width ? crop.width * scaleX : image.naturalWidth;
      const cropH = crop?.height ? crop.height * scaleY : image.naturalHeight;
      const cropX = crop?.x ? crop.x * scaleX : 0;
      const cropY = crop?.y ? crop.y * scaleY : 0;

      canvas.width = cropW;
      canvas.height = cropH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('No ctx');

      ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

      canvas.toBlob((blob) => {
        if (!blob) return reject('Canvas empty');
        resolve(blob);
      }, 'image/png');
    });
  };

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!processedImage || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const img = new Image();
    img.src = processedImage;
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] <= alphaThreshold) {
          data[i + 3] = 0; // Make pixels below threshold fully transparent
        }
      }

      ctx.putImageData(imageData, 0, 0);
    };
  }, [processedImage, alphaThreshold]);

  const processImage = async () => {
    setIsProcessing(true);
    addLog('Starting background removal process...');
    try {
      addLog('Cropping image locally...');
      const blob = await getCroppedImg();
      addLog(`Crop successful. Blob size: ${(blob.size / 1024).toFixed(2)} KB`);
      
      let finalBlob = blob;
      
      if (!isTransparent) {
        addLog('Applying @imgly AI background removal (WASM)...');
        addLog('This may take a moment to download the model on the first run.');
        
        const { removeBackground } = await import('@imgly/background-removal');
        
        finalBlob = await removeBackground(blob, {
          progress: (key, current, total) => {
            const pct = Math.round((current / total) * 100);
            if (pct === 100) {
               addLog(`Downloading AI Model: ${key} - 100%`);
            }
          }
        });
        
        addLog(`AI Background removal complete. Result size: ${(finalBlob.size / 1024).toFixed(2)} KB`);
      } else {
        addLog('Image is already marked as transparent. Skipping AI removal.');
      }

      setProcessedImage(URL.createObjectURL(finalBlob));
      addLog('Image processed and ready for preview!');
    } catch (err: any) {
      console.error(err);
      addLog(`EXCEPTION in processImage: ${err.message || err.toString()}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadPdf = async () => {
    if (!processedImage) return;
    setIsProcessing(true);
    addLog('Starting PDF generation process...');
    try {
      // If we want the PDF to literally have the thresholded image instead of just
      // the thresholded cutline, we can export the preview canvas!
      addLog('Fetching processed image blob from preview canvas...');
      const canvas = previewCanvasRef.current;
      if (!canvas) throw new Error("Canvas not ready");

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject('Canvas toBlob failed'), 'image/png');
      });

      const formData = new FormData();
      formData.append('image', blob, 'processed.png');
      formData.append('margin', margin.toString());
      formData.append('alphaThreshold', alphaThreshold.toString());

      addLog(`Sending POST to /api/generate-pdf with margin: ${margin}mm, alpha: ${alphaThreshold}`);
      const response = await fetch('http://localhost:3001/api/generate-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errText = await response.text();
        addLog(`ERROR ${response.status}: ${response.statusText} - ${errText}`);
        throw new Error(`Server returned ${response.status}: ${errText}`);
      }

      addLog('PDF Response received! Triggering download...');
      const pdfBlob = await response.blob();
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Sticker_Cutline.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      addLog('PDF Downloaded successfully!');
    } catch (err: any) {
      console.error(err);
      addLog(`EXCEPTION in downloadPdf: ${err.message || err.toString()}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Sticker Gen</h1>
        <p>Convert any image into a 200x200mm print-ready sticker with a vector contour cutline.</p>
      </header>

      <main className="main-content">
        <div className="panel preview-container">
          <AnimatePresence mode="wait">
            {!srcImage ? (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`dropzone ${isDragActive ? 'active' : ''}`}
                {...getRootProps()}
              >
                <input {...getInputProps()} />
                <Upload size={48} color="var(--accent)" />
                <div>
                  <h3>Drag & Drop your image here</h3>
                  <p>or click to browse files</p>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="preview"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="canvas-wrapper"
              >
                {isProcessing && (
                  <div className="loading-overlay">
                    <div className="spinner"></div>
                    <p>Processing Magic...</p>
                  </div>
                )}
                
                {!processedImage ? (
                  <ReactCrop crop={crop} onChange={c => setCrop(c)}>
                    <img 
                      ref={imgRef}
                      src={srcImage} 
                      alt="Source" 
                    />
                  </ReactCrop>
                ) : (
                  <canvas ref={previewCanvasRef} style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="panel settings-panel">
          <div className="settings-group">
            <label>1. Select Subject (Crop)</label>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Drag over the image to crop out unnecessary parts and isolate the subject.
            </p>
          </div>

          <div className="settings-group">
            <label>2. Transparent Source?</label>
            <div className="flex-between" style={{ marginTop: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Is the background already removed?</span>
              <input 
                type="checkbox" 
                checked={isTransparent}
                onChange={(e) => setIsTransparent(e.target.checked)}
                style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--accent)' }}
              />
            </div>
          </div>

          <div className="settings-group">
            <label>3. Cutline Margin ({margin}mm)</label>
            <div className="slider-container">
              <input 
                type="range" 
                className="slider"
                min="0" max="20" step="1"
                value={margin}
                onChange={(e) => setMargin(parseFloat(e.target.value))}
              />
            </div>
          </div>

          <div className="settings-group">
            <label>
              4. Alpha Threshold
              <span className="slider-value">{alphaThreshold}</span>
            </label>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Adjust if the cutline has ghosting. Default: 20
            </p>
            <div className="slider-container">
              <input 
                type="range" 
                className="slider"
                min="0" max="255" step="1"
                value={alphaThreshold}
                onChange={(e) => setAlphaThreshold(parseInt(e.target.value))}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem' }}>
            {srcImage && !processedImage && (
              <button className="btn btn-primary" onClick={processImage} disabled={isProcessing}>
                <Wand2 size={20} /> Remove Background
              </button>
            )}

            {processedImage && (
              <>
                <button className="btn btn-primary" onClick={downloadPdf} disabled={isProcessing}>
                  <Download size={20} /> Export 200x200mm PDF
                </button>
                <button 
                  className="btn btn-secondary" 
                  onClick={() => setProcessedImage(null)}
                  disabled={isProcessing}
                >
                  <RefreshCw size={20} /> Adjust Crop
                </button>
              </>
            )}

            {srcImage && (
              <button 
                className="btn btn-secondary" 
                onClick={() => {
                  setSrcImage(null);
                  setProcessedImage(null);
                  setCrop(undefined);
                }}
                disabled={isProcessing}
                style={{ marginTop: '1rem' }}
              >
                Upload New Image
              </button>
            )}
          </div>
        </div>
      </main>

      <div className="panel terminal-panel" style={{ marginTop: '2rem' }}>
        <div className="header flex-between">
          <span>Terminal Log</span>
          <button onClick={() => setLogs([])} style={{ background: 'none', border: 'none', color: '#5b6282', cursor: 'pointer' }}>Clear</button>
        </div>
        <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {logs.length === 0 ? <span style={{ color: '#5b6282' }}>Waiting for action...</span> : null}
          {logs.map((log, i) => (
            <div key={i} className="log-line">
              <span className="log-time">{log.split('] ')[0]}]</span>
              <span>{log.split('] ')[1]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default App;
