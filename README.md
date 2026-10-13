# IIUC-CSE-RESOURCE
THIS A PRIVATE REPO.
# 📚 CSE Resource Hub

A modern, responsive web application for browsing and downloading university CSE (Computer Science & Engineering) resources — integrated with both **web browsers** and **Telegram Bot**.

## ✨ Features

- **📂 Semester-wise Resource Browsing** — Select semester → exam type → course to find resources
- **📄 File Preview** — Preview PDF and image files directly in the browser
- **⬇️ Single & Bulk Download** — Download individual files or select multiple files and download as ZIP
- **🤖 Telegram Bot Integration** — Works as a Telegram Mini App with file sharing to chats
- **🌗 Dark / Light Theme** — Toggle between themes with persistent preference
- **📱 Fully Responsive** — Optimized for mobile, tablet, and desktop viewports
- **⚡ Fast GitHub-backed Storage** — Resources served directly from GitHub repository via API
- **🛡️ Secret Admin Panel Route** — Hidden management dashboard located at route `/acc/ad`
- **📢 Telegram Broadcast System** — Send rich announcements with interactive **Inline Buttons** to all subscribers
- **🌐 Server-First Hybrid Architecture** — Auto-detects backend server (`server.js`); if server is on, operates via server; if server is offline or errors, seamlessly falls back to the normal direct client system

## 🛠️ Tech Stack

- Frontend : HTML, Vanilla CSS, Vanilla JS
- Backend Options : Node.js Server (`server.js`) + Netlify Serverless Functions
- Storage : GitHub Repository API & Raw CDN

### Running the Project

```bash
# Clone the repository
git clone https://github.com/11UCRES/cse.git
cd cse

# (Optional) Run the Backend Server
npm start
# Server runs on http://localhost:5000 (with health check at /health)

# Or simply open index.html directly (runs in Serverless Fallback mode!)
```

## 🤖 Telegram Integration

This app works as a **Telegram Mini App**. When opened inside Telegram:

- Automatically detects the Telegram environment
- Shows connection status with a Telegram icon
- Allows sending files directly to Telegram chats
- Sends user activity info to admin

## 🎨 Theming

The app supports **light** and **dark** themes with smooth transitions. Theme preference is saved to `localStorage` and persists across sessions.

## 📝 License

This project is open source and available for educational purposes.

---

<p align="center">
  Built with ❤️ for IIUC CSE students
</p>
