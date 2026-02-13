import { Component, OnInit, Inject, OnDestroy, ViewChild, Output, EventEmitter } from '@angular/core';
import { HmiService } from '../../../_services/hmi.service';
import { MAT_DIALOG_DATA as MAT_DIALOG_DATA, MatDialogRef as MatDialogRef } from '@angular/material/dialog';
import { Device, EasyDrvTagType, Tag } from '../../../_models/device';
import { Subject, takeUntil } from 'rxjs';
import { TreetableComponent, Node, NodeType } from '../../../gui-helpers/treetable/treetable.component';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';

@Component({
    selector: 'app-tag-property-edit-easydrv',
    templateUrl: './tag-property-edit-easydrv.component.html',
    styleUrls: ['./tag-property-edit-easydrv.component.scss']
})
export class TagPropertyEditEasyDrvComponent implements OnInit, OnDestroy {

    formGroup: UntypedFormGroup;
    @Output() result = new EventEmitter<any>();
    private destroy$ = new Subject<void>();
    @ViewChild(TreetableComponent, {static: false}) treetable: TreetableComponent;
    tagType = EasyDrvTagType;
    prefix = '';

    config = {
        height: '640px',
        width: '1000px'
    };

    constructor(
        private fb: UntypedFormBuilder,
        private hmiService: HmiService,
        public dialogRef: MatDialogRef<TagPropertyEditEasyDrvComponent>,
        @Inject(MAT_DIALOG_DATA) public data: TagPropertyEasyDrvData) {
        }

    ngOnInit() {
        if (this.data.tag) {
            this.formGroup = this.fb.group({
                deviceName: [this.data.device.name, Validators.required],
                tagName: [this.data.tag.name, Validators.required],
                tagType: [this.data.tag.type],
                tagAddress: [this.data.tag.address, Validators.required],
                tagDescription: [this.data.tag.description]
            });
        } else {
            this.hmiService.onDeviceBrowse.pipe(
                takeUntil(this.destroy$),
            ).subscribe(values => {
                if (this.data.device.id === values.device) {
                    if (values.error) {
                        // browse error — ignore
                    } else {
                        this.addNodes(values.node, values.result);
                    }
                }
            });
            this.queryNext(null);
        }
    }

    ngOnDestroy() {
        this.destroy$.next(null);
        this.destroy$.complete();
    }

    queryNext(node: Node) {
        let n = (node) ? { id: node.id } : null;
        if (node) {
            n['parent'] = (node.parent) ? node.parent.id : null;
        }
        this.hmiService.askDeviceBrowse(this.data.device.id, n);
    }

    addNodes(parent: Node, nodes: any) {
        if (nodes) {
            let tempTags = Object.values(this.data.device.tags);
            nodes.forEach((n) => {
                let node = new Node(n.id, n.name);
                node.class = n.class;
                node.property = this.getProperty(n);
                if (n.type) {
                    node.type = n.type;
                }
                let enabled = true;
                if (node.class === NodeType.Variable) {
                    const selected = tempTags.find((t: Tag) => t.address === n.id);
                    if (selected) {
                        enabled = false;
                    }
                }
                this.treetable.addNode(node, parent, enabled, false);
            });
            this.treetable.update();
        }
    }

    getProperty(n: any) {
        if (n.class === NodeType.Object) {
            return '';
        } else if (n.class === NodeType.Variable) {
            return n.type || 'Variable';
        }
        return '';
    }

    onImportCdbx(event: Event) {
        const input = event.target as HTMLInputElement;
        if (!input.files || !input.files.length) return;
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = () => {
            const xml = reader.result as string;
            const tags = this.parseCdbxXml(xml);
            if (tags.length) {
                this.addCdbxNodes(tags);
            }
        };
        reader.readAsText(file);
        input.value = '';
    }

    private parseCdbxXml(xml: string): CdbxTag[] {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'text/xml');
        const tags: CdbxTag[] = [];
        const channels = doc.getElementsByTagName('channels:channel');
        for (let i = 0; i < channels.length; i++) {
            const ch = channels[i];
            const descr = ch.getElementsByTagName('channels:descr')[0]?.textContent?.trim();
            const enabled = ch.getElementsByTagName('channels:enabled')[0]?.textContent?.trim();
            if (!descr || enabled === '0') continue;
            let isString = false;
            const params = ch.getElementsByTagName('parameters:parameter');
            for (let j = 0; j < params.length; j++) {
                const name = params[j].getElementsByTagName('parameters:name')[0]?.textContent?.trim();
                const value = params[j].getElementsByTagName('parameters:value')[0]?.textContent?.trim();
                if (name === 'IsString' && value === '1') {
                    isString = true;
                }
            }
            tags.push({
                address: descr,
                type: isString ? EasyDrvTagType.String : EasyDrvTagType.Number
            });
        }
        return tags;
    }

    private addCdbxNodes(tags: CdbxTag[]) {
        const tempTags = Object.values(this.data.device.tags);
        const objectNodes: { [key: string]: Node } = {};
        tags.forEach(tag => {
            const addr = tag.address;
            const dotIdx = addr.indexOf('.');
            if (dotIdx < 0) return;
            const objName = addr.substring(0, dotIdx);
            const rest = addr.substring(dotIdx + 1);
            if (!objectNodes[objName]) {
                const objNode = new Node('t.' + objName, objName);
                objNode.class = NodeType.Object;
                objNode.property = '';
                const alreadyExists = !!this.treetable.nodes['t.' + objName];
                if (!alreadyExists) {
                    this.treetable.addNode(objNode, null, true, false);
                }
                objectNodes[objName] = this.treetable.nodes['t.' + objName];
            }
            const parentObj = objectNodes[objName];
            const tagId = 't.' + addr.replace(/\[\s*(\d+)\s*\]/g, '.$1');
            const tagName = rest.replace(/\[\s*(\d+)\s*\]/g, '.$1');
            const leafNode = new Node(tagId, tagName);
            leafNode.class = NodeType.Variable;
            leafNode.type = tag.type;
            leafNode.property = tag.type;
            let enabled = true;
            const selected = tempTags.find((t: Tag) => t.address === tagId);
            if (selected) {
                enabled = false;
            }
            if (!this.treetable.nodes[tagId]) {
                leafNode.checked = enabled;
                this.treetable.addNode(leafNode, parentObj, enabled, false);
            }
        });
        this.treetable.update();
    }

    onNoClick(): void {
        this.dialogRef.close();
    }

    onOkClick(): void {
        if (this.data.tag) {
            this.result.emit(this.formGroup.getRawValue());
        } else {
            this.data.nodes = [];
            this.data.prefix = this.prefix;
            Object.keys(this.treetable.nodes).forEach((key) => {
                let n: Node = this.treetable.nodes[key];
                if (n.checked && n.enabled && (n.type || !n.childs || n.childs.length == 0)) {
                    this.data.nodes.push(this.treetable.nodes[key]);
                }
            });
            this.result.emit(this.data);
        }
    }
}

export interface TagPropertyEasyDrvData {
    device: Device;
    nodes?: Node[];
    tag?: Tag;
    prefix?: string;
}

interface CdbxTag {
    address: string;
    type: string;
}
