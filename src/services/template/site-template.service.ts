export function generateIndexHtml(domain: string) {
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${domain}</title>
    <meta name="description" content="Website for ${domain}" />
    <style>
      :root {
        color-scheme: light;
        --bg: #0b1020;
        --card: #121933;
        --text: #f3f6ff;
        --muted: #b7c1e0;
        --accent: #6ea8fe;
        --accent-2: #8ef0c8;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: Inter, Arial, sans-serif;
        background:
          radial-gradient(circle at top right, rgba(110,168,254,0.18), transparent 25%),
          radial-gradient(circle at bottom left, rgba(142,240,200,0.12), transparent 25%),
          var(--bg);
        color: var(--text);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 860px;
        background: rgba(18, 25, 51, 0.88);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 24px;
        padding: 40px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.35);
        backdrop-filter: blur(10px);
      }
      .badge {
        display: inline-block;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(110,168,254,0.12);
        color: var(--accent);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      h1 {
        font-size: 48px;
        line-height: 1.05;
        margin: 18px 0 12px;
      }
      p {
        color: var(--muted);
        font-size: 18px;
        line-height: 1.7;
        margin: 0;
      }
      .grid {
        margin-top: 28px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
      }
      .item {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 18px;
        padding: 18px;
      }
      .item h2 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      .item p {
        font-size: 15px;
      }
      .footer {
        margin-top: 28px;
        font-size: 14px;
        color: var(--muted);
      }
      .highlight {
        color: var(--accent-2);
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="badge">Vedantix Deployment</span>
      <h1>${domain} is live.</h1>
      <p>
        This starter website was provisioned automatically by
        <span class="highlight">Vedantix</span>.
      </p>
  
      <section class="grid">
        <article class="item">
          <h2>Fast delivery</h2>
          <p>Your new website infrastructure has been provisioned and deployed automatically.</p>
        </article>
        <article class="item">
          <h2>Secure by default</h2>
          <p>Hosted behind CloudFront with DNS and certificate automation handled by the platform.</p>
        </article>
        <article class="item">
          <h2>Ready to customize</h2>
          <p>You can now replace this starter page with your real project files and workflow.</p>
        </article>
      </section>
  
      <div class="footer">
        Domain: <strong>${domain}</strong>
      </div>
    </main>
  </body>
  </html>`;
  }
  
  export function generatePackageJson() {
    return JSON.stringify(
      {
        name: 'customer-site',
        private: true,
        version: '1.0.0',
        scripts: {
          build: 'node scripts/build.js'
        }
      },
      null,
      2
    );
  }
  
  export function generateBuildScript() {
    return `const fs = require('fs');
  const path = require('path');
  
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }
  
  const sourceFiles = ['index.html'];
  
  for (const file of sourceFiles) {
    const from = path.join(rootDir, file);
    const to = path.join(distDir, file);
  
    if (!fs.existsSync(from)) {
      throw new Error(\`Missing source file: \${file}\`);
    }
  
    fs.copyFileSync(from, to);
  }
  
  console.log('Build completed. Files copied to dist/.');
  `;
  }