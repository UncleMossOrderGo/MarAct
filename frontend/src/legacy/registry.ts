import type { ComponentType } from 'react';
import { IdeaA } from './records/screen';
import { IdeaB } from './workspace/screen';
import { Marketplace as IdeaC } from '../features/marketplace/screen';

type Idea = {
  id: string;
  label: string;
  status: 'draft' | 'demo' | 'retired';
  Screen: ComponentType;
};

export const ideas: readonly Idea[] = [
  { id: 'idea-a', label: 'Idea A', status: 'demo', Screen: IdeaA },
  { id: 'idea-b', label: 'Idea B', status: 'demo', Screen: IdeaB },
  { id: 'idea-c', label: 'Idea C · Marketplace', status: 'demo', Screen: IdeaC },
];

export const demoIdeas = ideas.filter((idea) => idea.status === 'demo');

if (new Set(ideas.map(({ id }) => id)).size !== ideas.length) {
  throw new Error('Idea IDs must be unique.');
}
export function ideaPath(id: string) {
  return `/ideas/${id}`;
}
