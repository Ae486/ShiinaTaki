# core/server/methods/
- connect.ts — connect: the ONLY pre-auth method; token verify or pairing handshake, then authenticate the socket
- chat-send.ts — chat.send (operator-only): ack { messageId }, then stream agent tokens as chat.delta/.complete/.error
