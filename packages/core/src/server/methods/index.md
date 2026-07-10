# core/server/methods/
- connect.ts — connect: the ONLY pre-auth method; token verify or pairing handshake, then authenticate the socket
- chat-send.ts — chat.send (operator-only): ack { messageId }, then stream agent tokens as chat.delta/.complete/.error
- timeline-history.ts — timeline.history (operator-only): newest-first cursor page of the conversation timeline
- timeline-subscribe.ts — timeline.subscribe (operator-only): register a timeline.appended sink; auto-unsubscribe on disconnect
- approval-respond.ts — approval.respond (operator-only): resolve a pending MCP tool-approval ask; unknown id -> {accepted:false}
