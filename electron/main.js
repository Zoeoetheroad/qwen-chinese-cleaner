const path = require("path");
const { app, BrowserWindow, shell } = require("electron");

let mainWindow = null;
let localServer = null;

async function createWindow() {
  process.env.APP_DATA_DIR = app.getPath("userData");

  const { startServer } = require(path.join(__dirname, "..", "server.js"));
  const started = await startServer({ port: 0 });
  localServer = started.server;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "通义千问中文资料清洗工具",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${started.port}`);
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error(error);
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});
