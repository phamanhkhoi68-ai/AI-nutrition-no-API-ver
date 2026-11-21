const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const targetName = 'AI Nutitrion - UI.zip';
const downloadsDir = 'C:\\Users\\admin\\Downloads';
const targetPath = path.join(downloadsDir, targetName);

console.log('Exporting to:', targetPath);

if (fs.existsSync(targetPath)) {
  fs.unlinkSync(targetPath);
}

const tarCmd = `tar.exe -a -c -f "${targetPath}" --exclude="node_modules" --exclude=".git" --exclude="dist" --exclude="*.zip" src server api public tests scripts index.html vercel.json package.json package-lock.json tsconfig.json vite.config.ts .env .env.example README.md`;

execSync(tarCmd, { stdio: 'inherit', cwd: process.cwd() });

if (fs.existsSync(targetPath)) {
  const stat = fs.statSync(targetPath);
  console.log(`ZIP_EXPORT_SUCCESS: ${targetPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
} else {
  console.error('ZIP_EXPORT_FAILED: File not created.');
  process.exit(1);
}
