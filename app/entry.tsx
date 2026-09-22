import React from 'react';
import {createRoot} from 'react-dom/client';
import Home from './page';
import './globals.css';
import './studio/studio.css';
import './studio/theme-dark.css';
import {applyTheme} from './studio/theme';
applyTheme();
createRoot(document.getElementById('root')!).render(<Home/>);
