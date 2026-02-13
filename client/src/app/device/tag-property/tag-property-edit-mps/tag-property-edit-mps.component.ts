import { Component, OnInit, Inject, OnDestroy, ViewChild, Output, EventEmitter } from '@angular/core';
import { HmiService } from '../../../_services/hmi.service';
import { MAT_DIALOG_DATA as MAT_DIALOG_DATA, MatDialogRef as MatDialogRef } from '@angular/material/dialog';
import { Device, MpsTagType, Tag } from '../../../_models/device';
import { Subject, takeUntil } from 'rxjs';
import { TreetableComponent, Node, NodeType } from '../../../gui-helpers/treetable/treetable.component';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';

@Component({
    selector: 'app-tag-property-edit-mps',
    templateUrl: './tag-property-edit-mps.component.html',
    styleUrls: ['./tag-property-edit-mps.component.scss']
})
export class TagPropertyEditMpsComponent implements OnInit, OnDestroy {

    formGroup: UntypedFormGroup;
    @Output() result = new EventEmitter<any>();
    private destroy$ = new Subject<void>();
    @ViewChild(TreetableComponent, {static: false}) treetable: TreetableComponent;
    tagType = MpsTagType;
    prefix = '';

    config = {
        height: '640px',
        width: '1000px'
    };

    constructor(
        private fb: UntypedFormBuilder,
        private hmiService: HmiService,
        public dialogRef: MatDialogRef<TagPropertyEditMpsComponent>,
        @Inject(MAT_DIALOG_DATA) public data: TagPropertyMpsData) {
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

export interface TagPropertyMpsData {
    device: Device;
    nodes?: Node[];
    tag?: Tag;
    prefix?: string;
}
