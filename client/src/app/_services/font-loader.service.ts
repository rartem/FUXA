import { Injectable, Inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Define } from '../_helpers/define';
import { EndPointApi } from '../_helpers/endpointapi';
import { ResourcesService } from './resources.service';

@Injectable({
    providedIn: 'root'
})
export class FontLoaderService {

    constructor(
        private resourcesService: ResourcesService,
        @Inject(DOCUMENT) private document: Document
    ) { }

    loadCustomFonts() {
        this.resourcesService.getFonts().subscribe(result => {
            const groups = result?.groups || [];
            groups.forEach(group => {
                group.items?.forEach(item => {
                    if (item.name?.toLowerCase().endsWith('.ttf')) {
                        const fontFamily = item.label || item.name.replace(/\.[^/.]+$/, '');
                        this.injectFontFace(fontFamily, item.path);
                        if (Define.fonts.indexOf(fontFamily) === -1) {
                            Define.fonts.push(fontFamily);
                        }
                    }
                });
            });
        }, err => {
            console.error('Failed to load custom fonts', err);
        });
    }

    private injectFontFace(fontFamily: string, fontPath: string) {
        const styleId = `font-face-${fontFamily.replace(/\s+/g, '-')}`;
        if (this.document.getElementById(styleId)) {
            return;
        }
        const style = this.document.createElement('style');
        style.id = styleId;
        const url = `${EndPointApi.getURL()}/${fontPath}`;
        style.textContent = `@font-face { font-family: "${fontFamily}"; src: url("${url}") format("truetype"); }`;
        this.document.head.appendChild(style);
    }

    unloadFont(fontFamily: string) {
        const styleId = `font-face-${fontFamily.replace(/\s+/g, '-')}`;
        const existing = this.document.getElementById(styleId);
        if (existing) {
            existing.remove();
        }
        const idx = Define.fonts.indexOf(fontFamily);
        if (idx !== -1) {
            Define.fonts.splice(idx, 1);
        }
    }
}
