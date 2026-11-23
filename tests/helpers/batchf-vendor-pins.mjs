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
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 ItsWempo

// Batch F: sha256 pins for every vendored-verbatim browser file added by the
// account-security batch (upstream bytes, no banner). A changed byte fails
// tests/batchf-vendor.test.mjs until the pin is deliberately updated.
export const BATCHF_VENDOR_PINS = Object.freeze({
  "public/js/vendor/altcha-lib/v1/helpers.js":
    "a0cff253e44455cd57a9f77371b3006a8c8f6c4158d85d48a7e2f7f5d648a282",
  "public/js/vendor/altcha-lib/v1/index.js":
    "2a14af1cd2800ee68afc944cde4dad5622fe1b0bd66e930411332338cb6b85c8",
  "public/js/vendor/eff-wordlist/wordlist.json":
    "2356977166b8de4eb3ab328fe584c54f83d6dd7ddd1fb18d56ecb8b801a28556",
  "public/js/vendor/qrcode-generator/qrcode.mjs":
    "ea91d7118a5395289170da848b7c6758b996163bfbccf312591ab65a4911b7c0",
  "public/js/vendor/simplewebauthn-browser/helpers/base64URLStringToBuffer.js":
    "9d248791ed9402f760191b2c564f07298349db8094fb46f6d6f5514ea841a888",
  "public/js/vendor/simplewebauthn-browser/helpers/browserSupportsPasskeys.js":
    "efea4b1947092861a4add0f22783e2cc8cf4143aca8e456497a6eeefc56bf0d8",
  "public/js/vendor/simplewebauthn-browser/helpers/browserSupportsWebAuthn.js":
    "380b32287f6e9939a9f7116695f75266303ef9554f97dc7174c72b47233dbe0a",
  "public/js/vendor/simplewebauthn-browser/helpers/browserSupportsWebAuthnAutofill.js":
    "2c0af6c79d11d828e9b9e802c2afded2aa263152731faa9a1b61aabadd809cb3",
  "public/js/vendor/simplewebauthn-browser/helpers/bufferToBase64URLString.js":
    "88029dcea67ba140a49ef0bf1bdbe5332e11d5fb4d87727f698ec6d1ff3715ea",
  "public/js/vendor/simplewebauthn-browser/helpers/getBrowserCapabilities.js":
    "10d68c01f5818c614a23968702912f47622c5bd59df052f0873a07c9b70ba754",
  "public/js/vendor/simplewebauthn-browser/helpers/identifyAuthenticationError.js":
    "3761c6d753e74e4c15bc7a7e33b55e62e8697e1c281fb7585f4608d25cfc1d51",
  "public/js/vendor/simplewebauthn-browser/helpers/identifyRegistrationError.js":
    "766cd394739671e945d0f0a86dc9c61e3e9db76bffdb1332c5be68502b0eebcb",
  "public/js/vendor/simplewebauthn-browser/helpers/identifySignalError.js":
    "c57eea191ba740906bb2f7f33c11086a48b544485c3e8fd9c9d29905e9f077fc",
  "public/js/vendor/simplewebauthn-browser/helpers/isValidDomain.js":
    "c5502b39d34af93479949832bb8ad07f525ce227e81d2f391fa464c81cd6f7a2",
  "public/js/vendor/simplewebauthn-browser/helpers/platformAuthenticatorIsAvailable.js":
    "49032b0e73236dd3d423db6fb5f12e89aa8f3338f65ca4bc6b04caabd43b18ed",
  "public/js/vendor/simplewebauthn-browser/helpers/toAuthenticatorAttachment.js":
    "228e53bea373270efed6b3dfef6e86df63414515201a7c5a3449bc0288e9aaa2",
  "public/js/vendor/simplewebauthn-browser/helpers/toPublicKeyCredentialDescriptor.js":
    "9603668329ad8434a2c72db3a5a1de8485a78acd13d20879535a7ef48a1599ae",
  "public/js/vendor/simplewebauthn-browser/helpers/webAuthnAbortService.js":
    "47614557330b02b3a148ce0d72030a05b3d21a1377ed1b0fbe198c7362f7eb52",
  "public/js/vendor/simplewebauthn-browser/helpers/webAuthnError.js":
    "85b068fedbdd2650d9814ff78515c5188ba9542037b88566841890cce72a364f",
  "public/js/vendor/simplewebauthn-browser/index.js":
    "bfd83561728e830b3d6fd96dc692819cb61a6fab2c7b3b19ef325e6defe6abf4",
  "public/js/vendor/simplewebauthn-browser/methods/sendSignal.js":
    "3415bef3710e9bf49050d8b52582d63d14006e1e26cb330ac5ee1bb0e095f06a",
  "public/js/vendor/simplewebauthn-browser/methods/startAuthentication.js":
    "6da059623b16c2b318ef0f0475bd5b42a5073bf9ee63bb65e90b042f45ad8da2",
  "public/js/vendor/simplewebauthn-browser/methods/startRegistration.js":
    "d3b6a114abbb7a3779977a0ffa6d5ab25777240f3b4f462a6de531ecdb98589f",
  "public/js/vendor/simplewebauthn-browser/types/dom.js":
    "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881",
  "public/js/vendor/simplewebauthn-browser/types/index.js":
    "8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881",
  "public/js/vendor/zxcvbn-ts/core.js":
    "d6f1d29f7e9b89d5b8aa0195d01a5ddecc9eb56180a8748efd904265148e19aa",
  "public/js/vendor/zxcvbn-ts/language-common.js":
    "4541249ca2e666230b9a5ca729162ce7feb0891255ec92914a7f173dc507843a",
  "public/js/vendor/zxcvbn-ts/language-en.js":
    "8097ebef4edc2ecd3a501658b96ad3f52b92483dd733fceeb8c9af1c7ff27068",
});
