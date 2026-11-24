const s = (d) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const I = {
  panel: s('<path d="M3.5 16.5a8.5 8.5 0 1 1 17 0"/><path d="M12 16.5l4.5-5"/><circle cx="12" cy="16.5" r="1.3"/><path d="M6.2 11.2l1.2.9M12 7.6v1.4M17.8 11.2l-1.2.9"/>'),
  agenda: s('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 9.5h18"/><circle cx="12" cy="15" r="3.2"/><path d="M12 13.4v1.8l1.1.8"/>'),
  rep: s('<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 10h5.5l4 6.5"/><path d="M14.5 10l1.6-4h2.4"/><path d="M9 10 7.8 7.2H5.5"/><path d="M10.5 13.2h3.2"/>'),
  clientes: s('<path d="M3.5 15.5C3.5 9.9 7.3 6 12.3 6c4.6 0 7.8 3.2 8.2 7.6l.2 2.4a1.8 1.8 0 0 1-1.8 2H6a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M12 11.2h8.4"/><path d="M12 11.2v6.8"/>'),
  almacen: s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
  fact: s('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M14.6 8.3a3.2 3.2 0 1 0 0 5.4"/><path d="M8.6 10.2h4.2M8.6 12h4.2"/>'),
  config: s('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  pin: s('<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>'),
  registro: s('<path d="M12 8v4l2.5 1.5"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><path d="M3 4v7h7"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  left: s('<path d="m15 18-6-6 6-6"/>'),
  right: s('<path d="m9 18 6-6-6-6"/>'),
  moto: s('<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M15 6h2l3 7M5.5 17l4-7h5l4 7M9 6h3"/>'),
  print: s('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
  sign: s('<path d="M3 17c3-3 5-9 7-9s-1 9 2 9 3-5 5-5 1 3 4 3"/><path d="M3 21h18"/>'),
};
