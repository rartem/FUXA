import { Component, DoCheck, EventEmitter, Input, Output } from '@angular/core';
import { View, ViewType, ViewFolder } from '../../_models/hmi';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../gui-helpers/confirm-dialog/confirm-dialog.component';
import { MatDialog as MatDialog } from '@angular/material/dialog';
import { ProjectService } from '../../_services/project.service';
import { ViewPropertyComponent, ViewPropertyType } from '../view-property/view-property.component';
import * as FileSaver from 'file-saver';
import { EditNameComponent, EditNameData } from '../../gui-helpers/edit-name/edit-name.component';
import { Utils } from '../../_helpers/utils';

interface TreeNode {
    id: string;
    name: string;
    type: 'folder' | 'view';
    level: number;
    expanded: boolean;
    data: View | ViewFolder;
    children?: TreeNode[];
}

@Component({
    selector: 'app-editor-views-list',
    templateUrl: './editor-views-list.component.html',
    styleUrls: ['./editor-views-list.component.scss']
})
export class EditorViewsListComponent implements DoCheck {

    @Input() views: View[] = [];
    @Input() folders: ViewFolder[] = [];
    @Input('select') set select(view: View) {
        this.currentView = view;
    };
    @Output() selected: EventEmitter<View> = new EventEmitter<View>();
    @Output() viewPropertyChanged: EventEmitter<View> = new EventEmitter<View>();
    @Output() cloneView: EventEmitter<View> = new EventEmitter<View>();
    @Output() addView: EventEmitter<string> = new EventEmitter<string>();

    currentView: View = null;
    treeNodes: TreeNode[] = [];
    private lastViewsLength = 0;
    private lastFoldersLength = 0;

    cardViewType = ViewType.cards;
    svgViewType = ViewType.svg;
    mapsViewType = ViewType.maps;

    constructor(private projectService: ProjectService,
        private translateService: TranslateService,
        public dialog: MatDialog,
    ) { }

    ngOnChanges() {
        this.buildTree();
    }

    ngDoCheck() {
        const vLen = this.views?.length || 0;
        const fLen = this.folders?.length || 0;
        if (vLen !== this.lastViewsLength || fLen !== this.lastFoldersLength) {
            this.lastViewsLength = vLen;
            this.lastFoldersLength = fLen;
            this.buildTree();
        }
    }

    buildTree() {
        const validFolderIds = new Set((this.folders || []).map(f => f.id));
        this.treeNodes = this.buildNodes(null, 0, validFolderIds);
    }

    buildNodes(parentId: string | null, level: number, validFolderIds: Set<string>): TreeNode[] {
        const result: TreeNode[] = [];
        // Add folders
        const folderList = (this.folders || []).filter(f => {
            const actualParent = (f.parentId && validFolderIds.has(f.parentId)) ? f.parentId : null;
            return actualParent === parentId;
        }).sort((a, b) => a.name.localeCompare(b.name));
        for (const folder of folderList) {
            const node: TreeNode = {
                id: folder.id,
                name: folder.name,
                type: 'folder',
                level,
                expanded: folder.expanded !== false,
                data: folder,
                children: []
            };
            node.children = this.buildNodes(folder.id, level + 1, validFolderIds);
            result.push(node);
        }
        // Add views
        const viewList = (this.views || []).filter(v => {
            const actualParent = (v.folderId && validFolderIds.has(v.folderId)) ? v.folderId : null;
            return actualParent === parentId;
        }).sort((a, b) => a.name.localeCompare(b.name));
        for (const view of viewList) {
            result.push({
                id: view.id,
                name: view.name,
                type: 'view',
                level,
                expanded: false,
                data: view
            });
        }
        return result;
    }

    getVisibleNodes(): TreeNode[] {
        const visible: TreeNode[] = [];
        const addNodes = (nodes: TreeNode[]) => {
            for (const node of nodes) {
                visible.push(node);
                if (node.type === 'folder' && node.expanded && node.children) {
                    addNodes(node.children);
                }
            }
        };
        addNodes(this.treeNodes);
        return visible;
    }

    onSelectView(view: View, force = true) {
        if (!force && this.currentView?.id === view?.id) {
            return;
        }
        this.currentView = view;
        this.selected.emit(this.currentView);
    }

    isViewActive(view) {
        return (this.currentView && this.currentView.id === view.id);
    }

    toggleFolder(node: TreeNode) {
        node.expanded = !node.expanded;
        const folder = node.data as ViewFolder;
        folder.expanded = node.expanded;
        this.projectService.setFolder(folder);
    }

    onAddFolder(parentId?: string) {
        const dialogRef = this.dialog.open(EditNameComponent, {
            disableClose: true,
            position: { top: '60px' },
            data: <EditNameData>{
                title: this.translateService.instant('dlg.foldername-title'),
                name: '',
                exist: (this.folders || []).map(f => f.name)
            }
        });
        dialogRef.afterClosed().subscribe(result => {
            if (result?.name) {
                const folder = new ViewFolder(Utils.getShortGUID('f_'), result.name, parentId);
                this.folders.push(folder);
                this.projectService.setFolder(folder);
                this.buildTree();
            }
        });
    }

    onRenameFolder(node: TreeNode) {
        const folder = node.data as ViewFolder;
        const exist = (this.folders || []).filter(f => f.id !== folder.id).map(f => f.name);
        const dialogRef = this.dialog.open(EditNameComponent, {
            disableClose: true,
            position: { top: '60px' },
            data: <EditNameData>{
                title: this.translateService.instant('dlg.foldername-title'),
                name: folder.name,
                exist
            }
        });
        dialogRef.afterClosed().subscribe(result => {
            if (result?.name) {
                folder.name = result.name;
                this.projectService.setFolder(folder);
                this.buildTree();
            }
        });
    }

    onDeleteFolder(node: TreeNode) {
        const folder = node.data as ViewFolder;
        const msg = this.translateService.instant('msg.folder-remove', { value: folder.name });
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
            position: { top: '60px' },
            data: <ConfirmDialogData>{ msg }
        });
        dialogRef.afterClosed().subscribe(result => {
            if (result) {
                this.projectService.removeFolder(folder);
                this.buildTree();
            }
        });
    }

    onMoveViewToFolder(view: View, folderId: string) {
        view.folderId = folderId;
        this.projectService.setView(view);
        this.buildTree();
    }

    onMoveFolderToFolder(folder: ViewFolder, parentId: string) {
        folder.parentId = parentId;
        this.projectService.setFolder(folder);
        this.buildTree();
    }

    onDeleteView(view) {
        let msg = '';
        this.translateService.get('msg.view-remove', { value: view.name }).subscribe((txt: string) => { msg = txt; });
        let dialogRef = this.dialog.open(ConfirmDialogComponent, {
            position: { top: '60px' },
            data: <ConfirmDialogData> { msg: this.translateService.instant('msg.view-remove', { value: view.name }) }
        });

        dialogRef.afterClosed().subscribe(result => {
            if (result && this.views) {
                let toselect = null;
                for (var i = 0; i < this.views.length; i++) {
                    if (this.views[i].id === view.id) {
                        this.views.splice(i, 1);
                        if (i > 0 && i < this.views.length) {
                            toselect = this.views[i];
                        }
                        break;
                    }
                }
                this.currentView = null;
                if (toselect) {
                    this.onSelectView(toselect);
                } else if (this.views.length > 0) {
                    this.onSelectView(this.views[0]);
                }
                this.projectService.removeView(view);
                this.buildTree();
            }
        });
    }

    onRenameView(view) {
        let exist = this.views.filter((v) => v.id !== view.id).map((v) => v.name);
        let dialogRef = this.dialog.open(EditNameComponent, {
            disableClose: true,
            position: { top: '60px' },
            data: <EditNameData> {
                title: this.translateService.instant('dlg.docname-title'),
                name: view.name,
                exist: exist
            }
        });
        dialogRef.afterClosed().subscribe(result => {
            if (result && result.name) {
                view.name = result.name;
                this.projectService.setView(view, false);
                this.buildTree();
            }
        });
    }

    onPropertyView(view) {
        let dialogRef = this.dialog.open(ViewPropertyComponent, {
            position: { top: '60px' },
            disableClose: true,
            data: <ViewPropertyType> {
                name: view.name,
                type: view.type || ViewType.svg,
                profile: view.profile,
                property: view.property}
        });

        dialogRef.afterClosed().subscribe(result => {
            if (result?.profile) {
                if (result.profile.height) {view.profile.height = parseInt(result.profile.height);}
                if (result.profile.width) {view.profile.width = parseInt(result.profile.width);}
                if (result.profile.margin >= 0) {view.profile.margin = parseInt(result.profile.margin);}
                view.profile.bkcolor = result.profile.bkcolor;
                if (result.property?.events) {
                    view.property ??= { events: [], actions: [] };
                    view.property.events = result.property.events;
                }
                this.viewPropertyChanged.emit(view);
                this.onSelectView(view);
            }
        });
    }

    onCloneView(view: View) {
        this.cloneView.emit(view);
    }

    onExportView(view: View) {
        let filename = `${view.name}.json`;
        let content = JSON.stringify(view);
        let blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        FileSaver.saveAs(blob, filename);
    }

    onCleanView(view: View) {
       const changed = this.projectService.cleanView(view);
       if (changed) {
            this.onSelectView(view);
       }
    }

    getFolderTargets(excludeId?: string): ViewFolder[] {
        return (this.folders || []).filter(f => f.id !== excludeId);
    }
}
