// Copyright 2026 ItsWempo
//
// This file is part of Wempo's Forum.
//
// Wempo's Forum is free software: you can redistribute it and/or modify it
// under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the
// GNU Affero General Public License along with this program.  If not,
// see <https://www.gnu.org/licenses/>.

// ESLint flat config: the recommended rule set, with globals per runtime.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'api/vendor/**',
      'public/js/vendor/**',
      'node_modules/**',
      '.wrangler/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
  },
  {
    files: ['public/js/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['worker.mjs', 'constants.mjs', 'api/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.es2021 } },
  },
  {
    files: ['tests/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', '*.config.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
