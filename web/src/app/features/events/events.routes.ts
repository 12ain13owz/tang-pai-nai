import type { Routes } from '@angular/router'

export default [
  {
    path: '',
    title: 'title.events',
    loadComponent: async () => import('./pages/events-page/events-page').then((m) => m.EventsPage),
  },
  // An event's page; its title is the event's name.
  {
    path: ':id',
    title: 'title.events',
    loadComponent: async () => import('./pages/event-page/event-page').then((m) => m.EventPage),
  },
] satisfies Routes
