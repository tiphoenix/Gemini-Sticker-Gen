# StickerMaker AI

A modern web application to upload images, remove backgrounds, generate smooth contour cutlines with customizable margins, and export a print-ready PDF using the `CutContour` spot color (Roland standard).

## Tech Stack
- **Frontend**: React + Vite + Framer Motion (Vanilla CSS, Glassmorphism design)
- **Backend**: Node.js + Express
- **Background Removal**: `@imgly/background-removal-node`
- **Vectorization**: `potrace` (generates minimal-node smooth bezier curves)
- **PDF Generation**: `pdfkit` (for custom `CutContour` CMYK spot color)

## Local Development

Since this project uses a Node.js backend instead of Python, you don't need to install Python. Everything runs via NPM.

1. **Start Backend**:
   ```bash
   cd backend
   npm run dev
   ```
   *(Note: You'll need to add `"dev": "nodemon src/index.ts"` to `backend/package.json` scripts if not added automatically)*

2. **Start Frontend**:
   ```bash
   cd frontend
   npm run dev
   ```

## Deployment (Coolify)

This app can be deployed on Coolify using the Nixpacks builder or via a Docker Compose configuration. For production, the frontend should be built and served via Nginx or integrated with the Express backend to serve static files.

### Spot Colors Note
The PDF is generated using the PDFKit library, injecting a true PDF spot color named `CutContour` (CMYK 0,100,0,0). RIP software like VersaWorks will perfectly interpret this outline for contour cutting.
