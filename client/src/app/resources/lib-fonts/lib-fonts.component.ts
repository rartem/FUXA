import { Component, AfterViewInit, OnDestroy } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Subscription } from 'rxjs';

import { ResourceGroup, Resources } from '../../_models/resources';
import { ResourcesService } from '../../_services/resources.service';
import { MyFileService, TransferResult } from '../../_services/my-file.service';
import { ToastNotifierService } from '../../_services/toast-notifier.service';
import { FontLoaderService } from '../../_services/font-loader.service';

@Component({
    selector: 'app-lib-fonts',
    templateUrl: './lib-fonts.component.html',
    styleUrls: ['./lib-fonts.component.css']
})
export class LibFontsComponent implements AfterViewInit, OnDestroy {
    resFonts: ResourceGroup[] = [];
    subscription: Subscription;
    uploadSubscription: Subscription;

    constructor(
        private dialogRef: MatDialogRef<LibFontsComponent>,
        private resourcesService: ResourcesService,
        private myFileService: MyFileService,
        private toastNotifier: ToastNotifierService,
        private fontLoaderService: FontLoaderService) { }

    ngAfterViewInit() {
        this.loadFonts();
    }

    ngOnDestroy() {
        try {
            this.subscription?.unsubscribe();
            this.uploadSubscription?.unsubscribe();
        } catch (err) {
            console.error(err);
        }
    }

    loadFonts() {
        this.subscription = this.resourcesService.getFonts().subscribe((result: Resources) => {
            this.resFonts = result?.groups || [];
        }, err => {
            console.error('get fonts error: ' + err);
        });
    }

    onUploadFont(event: any) {
        const file = event.target.files[0];
        if (!file) {
            return;
        }
        if (!file.name.toLowerCase().endsWith('.ttf')) {
            this.toastNotifier.notifyError('msg.file-upload-failed', 'Only .ttf files are allowed');
            return;
        }
        this.uploadSubscription = this.myFileService.upload(file, 'resources').subscribe((result: TransferResult) => {
            if (result.result) {
                this.fontLoaderService.loadCustomFonts();
                this.loadFonts();
            } else {
                this.toastNotifier.notifyError('msg.file-upload-failed', result.error);
            }
        });
    }

    onRemoveFont(fontName: string) {
        const fontFamily = this.getFontFamily(fontName);
        this.resourcesService.removeResource(fontName).subscribe(() => {
            this.fontLoaderService.unloadFont(fontFamily);
            this.loadFonts();
        }, err => {
            console.error('remove font error: ' + err);
            this.toastNotifier.notifyError('msg.file-upload-failed', 'Remove failed');
        });
    }

    private getFontFamily(fontName: string): string {
        for (const group of this.resFonts) {
            for (const item of group.items || []) {
                if (item.name === fontName) {
                    return item.label || item.name.replace(/\.[^/.]+$/, '');
                }
            }
        }
        return fontName.replace(/\.[^/.]+$/, '');
    }

    onPreviewFont(fontPath: string, fontLabel: string) {
        // Preview is rendered inline via style
    }

    onNoClick(): void {
        this.dialogRef.close();
    }
}
