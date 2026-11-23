import { base64URLStringToBuffer } from './base64URLStringToBuffer.js';
export function toPublicKeyCredentialDescriptor(descriptor) {
    const { id } = descriptor;
    return {
        ...descriptor,
        id: base64URLStringToBuffer(id),
        transports: descriptor.transports,
        type: descriptor.type,
    };
}
