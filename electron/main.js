const path = require("path");
const fs = require("fs/promises");
const { app, BrowserWindow, shell } = require("electron");

let mainWindow = null;
let localServer = null;

async function migrateLegacyUserData(userDataDir) {
  const legacyDir = path.join(app.getPath("appData"), "千问中文资料清洗工具");
  const configFile = path.join(userDataDir, "config", "settings.json");
  const legacyConfigFile = path.join(legacyDir, "config", "settings.json");

  try {
    await fs.access(configFile);
  } catch (_error) {
    try {
      await fs.mkdir(path.dirname(configFile), { recursive: true });
      await fs.copyFile(legacyConfigFile, configFile);
    } catch (_copyError) {
      // No legacy config to migrate.
    }
  }
}

async function createWindow() {
  const userDataDir = app.getPath("userData");
  await migrateLegacyUserData(userDataDir);
  process.env.APP_DATA_DIR = userDataDir;

  const { startServer } = require(path.join(__dirname, "..", "server.js"));
  const started = await startServer({ port: 0 });
  localServer = started.server;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    title: "资料清洗工具",
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
