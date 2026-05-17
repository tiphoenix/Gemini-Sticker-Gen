import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { removeBackground } from '@imgly/background-removal-node';
import { PNG } from 'pngjs';
import potrace from 'potrace';
import PDFDocument from 'pdfkit';
import path from 'path';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve API endpoints


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

app.post('/api/process-image', upload.single('image'), async (req, res) => {
  // Keeping this for backwards compatibility, though frontend handles it now
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const isTransparent = req.body.isTransparent === 'true';
    let imageBuffer = req.file.buffer;

    if (!isTransparent) {
      const u8array = new Uint8Array(imageBuffer);
      const resultBlob = await removeBackground(u8array);
      const arrayBuffer = await resultBlob.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    }

    res.set('Content-Type', 'image/png');
    res.send(imageBuffer);
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ error: 'Failed to process image' });
  }
});

app.post('/api/generate-pdf', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    const imageBuffer = req.file.buffer;
    const marginMm = parseFloat(req.body.margin) || 0; // Margin in mm
    const alphaThreshold = parseInt(req.body.alphaThreshold) || 20;

    // Standard 200x200 mm canvas
    // 1 mm = 2.834645669 points
    const MM_TO_PTS = 2.834645669;
    const docW = 200 * MM_TO_PTS;
    const docH = 200 * MM_TO_PTS;

    // Parse image with PNGJS
    const srcPng = PNG.sync.read(imageBuffer);
    const width = srcPng.width;
    const height = srcPng.height;

    // Scale factor to fit image inside 200x200mm PDF
    const imgScale = Math.min(docW / width, docH / height);
    
    // Calculate margin in pixels
    const marginPts = marginMm * MM_TO_PTS;
    const marginPx = Math.round(marginPts / imgScale);

    // Create a new PNG for the silhouette with margin padding
    const outWidth = width + marginPx * 2;
    const outHeight = height + marginPx * 2;
    const silhouette = new PNG({ width: outWidth, height: outHeight });

    // Initialize with white background
    for (let i = 0; i < silhouette.data.length; i += 4) {
      silhouette.data[i] = 255;
      silhouette.data[i + 1] = 255;
      silhouette.data[i + 2] = 255;
      silhouette.data[i + 3] = 255;
    }

    const activePixels: {x: number, y: number}[] = [];
    
    // Helper to check if a pixel is solid
    const isSolid = (px: number, py: number) => {
      if (px < 0 || px >= width || py < 0 || py >= height) return false;
      const idx = (width * py + px) << 2;
      return srcPng.data[idx + 3] > alphaThreshold;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isSolid(x, y)) {
           // It's solid. Draw it in the silhouette.
           const outIdx = (outWidth * (y + marginPx) + (x + marginPx)) << 2;
           silhouette.data[outIdx] = 0;
           silhouette.data[outIdx+1] = 0;
           silhouette.data[outIdx+2] = 0;

           // Only add to activePixels for dilation if it's an edge pixel
           if (marginPx > 0) {
             const isEdge = !isSolid(x-1, y) || !isSolid(x+1, y) || !isSolid(x, y-1) || !isSolid(x, y+1);
             if (isEdge) {
               activePixels.push({x, y});
             }
           }
        }
      }
    }

    // Apply margin (dilation) from edge pixels only
    if (marginPx > 0) {
      const circleMask: {dx: number, dy: number}[] = [];
      const m2 = marginPx * marginPx;
      for (let dy = -marginPx; dy <= marginPx; dy++) {
        for (let dx = -marginPx; dx <= marginPx; dx++) {
          if (dx*dx + dy*dy <= m2) {
            circleMask.push({dx, dy});
          }
        }
      }

      for (const p of activePixels) {
        for (const m of circleMask) {
          const nx = p.x + marginPx + m.dx;
          const ny = p.y + marginPx + m.dy;
          if (nx >= 0 && nx < outWidth && ny >= 0 && ny < outHeight) {
            const outIdx = (outWidth * ny + nx) << 2;
            silhouette.data[outIdx] = 0;
            silhouette.data[outIdx+1] = 0;
            silhouette.data[outIdx+2] = 0;
          }
        }
      }
    }

    const silhouetteBuffer = PNG.sync.write(silhouette);

    potrace.trace(silhouetteBuffer, { 
      turdSize: 100,
      optCurve: true,
      alphaMax: 1,
      optTolerance: 0.2
    }, (err: any, svg: string) => {
      if (err) {
         console.error(err);
         return res.status(500).json({ error: 'Failed to trace image' });
      }

      const pathMatch = svg.match(/<path[^>]*d="([^"]*)"/);
      const pathData = pathMatch ? pathMatch[1] : '';

      const doc = new PDFDocument({ 
        size: [docW, docH],
        margin: 0
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="sticker_cutline.pdf"');
      doc.pipe(res);

      (doc as any).addSpotColor('CutContour', 0, 100, 0, 0);

      // Center the image + margin padding inside the 200x200 canvas
      const offsetX = (docW - outWidth * imgScale) / 2;
      const offsetY = (docH - outHeight * imgScale) / 2;

      doc.save();
      doc.translate(offsetX, offsetY);
      doc.scale(imgScale);
      
      // Place original image
      doc.image(imageBuffer, marginPx, marginPx, { width, height });

      // Draw SVG path
      if (pathData) {
        // Adjust the stroke width so it appears as 0.5pt regardless of scale
        doc.path(pathData)
           .lineWidth(0.5 / imgScale)
           .strokeColor('CutContour')
           .stroke();
      }
      
      doc.restore();
      doc.end();
    });

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const frontendDistPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDistPath));

  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
