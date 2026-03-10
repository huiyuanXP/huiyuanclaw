import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const templatesDir = join(__dirname, '..', 'templates');

export const [loginPage, dashboardPage, folderViewPage, chatPage] = await Promise.all([
  readFile(join(templatesDir, 'login.html'), 'utf8'),
  readFile(join(templatesDir, 'dashboard.html'), 'utf8'),
  readFile(join(templatesDir, 'folder-view.html'), 'utf8'),
  readFile(join(templatesDir, 'chat.html'), 'utf8'),
]);
