import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Main Process Configuration', () => {
  describe('Window configuration', () => {
    it('should include autoHideMenuBar in BrowserWindow options', () => {
      const mainTsPath = path.join(__dirname, '../main/index.ts');
      const content = fs.readFileSync(mainTsPath, 'utf-8');

      // Verify autoHideMenuBar is set to true
      expect(content).toContain('autoHideMenuBar: true');
    });

    it('should set application menu to null for native look', () => {
      const mainTsPath = path.join(__dirname, '../main/index.ts');
      const content = fs.readFileSync(mainTsPath, 'utf-8');

      // Verify Menu.setApplicationMenu(null) is called
      expect(content).toContain('Menu.setApplicationMenu(null)');
    });

    it('should import Menu from electron', () => {
      const mainTsPath = path.join(__dirname, '../main/index.ts');
      const content = fs.readFileSync(mainTsPath, 'utf-8');

      // Verify Menu is imported
      expect(content).toContain('import { app, BrowserWindow, shell, Menu }');
    });
  });

  describe('CSS configuration', () => {
    it('should prevent text selection in body for native desktop feel', () => {
      const cssPath = path.join(__dirname, '../renderer/styles/global.css');
      const content = fs.readFileSync(cssPath, 'utf-8');

      // Verify user-select: none is set on body
      expect(content).toContain('user-select: none');
      expect(content).toContain('-webkit-user-select: none');
    });

    it('should allow text selection in input elements', () => {
      const cssPath = path.join(__dirname, '../renderer/styles/global.css');
      const content = fs.readFileSync(cssPath, 'utf-8');

      // Verify inputs can select text
      expect(content).toMatch(/input.*\{[^}]*user-select:\s*text/s);
    });

    it('should allow text selection in Monaco Editor', () => {
      const cssPath = path.join(__dirname, '../renderer/styles/global.css');
      const content = fs.readFileSync(cssPath, 'utf-8');

      // Verify Monaco editor can select text
      expect(content).toMatch(/\.monaco-editor.*\{[^}]*user-select:\s*text/s);
    });
  });
});
