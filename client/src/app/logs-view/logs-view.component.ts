import { Component, AfterViewInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';

import { UntypedFormControl } from '@angular/forms';
import { MatTable as MatTable, MatTableDataSource as MatTableDataSource } from '@angular/material/table';
import { MatPaginator as MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

import { DiagnoseService } from '../_services/diagnose.service';
import { AppService } from '../_services/app.service';
import { LogsRequest } from '../_models/diagnose';

@Component({
    selector: 'app-logs-view',
    templateUrl: './logs-view.component.html',
    styleUrls: ['./logs-view.component.css']
})
export class LogsViewComponent implements AfterViewInit, OnDestroy {

    @ViewChild(MatTable, {static: false}) table: MatTable<any>;
    @ViewChild(MatSort, {static: false}) sort: MatSort;
    @ViewChild(MatPaginator, {static: false}) paginator: MatPaginator;
    @ViewChild('workPanel', {static: false}) workPanel: ElementRef;
    @ViewChild('textContent', {static: false}) textContent: ElementRef;

    dataSource = new MatTableDataSource([]);
    ontimeFilter = new UntypedFormControl();
    typeFilter = new UntypedFormControl();
    sourceFilter = new UntypedFormControl();
    textFilter = new UntypedFormControl();
    logFilter = new UntypedFormControl('');

    filteredValues = {
        ontime: '', source: '', type: '', text: ''
    };

    readonly displayColumns = ['ontime', 'type', 'source', 'text'];
    tableView = false;
    content = '';
    rawLines: string[] = [];
    logs = { selected: 'fuxa.log', files: [] };

    private filterSubscription: Subscription;

    constructor(private diagnoseService: DiagnoseService,
                private appService: AppService) { }

    ngAfterViewInit() {
        this.diagnoseService.getLogsDir().subscribe(result => {
            this.logs.files = result;
        }, err => {
            console.error('get Logs err: ' + err);
        });

        this.loadLogs(this.logs.selected);

        this.filterSubscription = this.logFilter.valueChanges.pipe(
            debounceTime(300)
        ).subscribe(() => {
            this.applyLogFilter();
        });
    }

    ngOnDestroy() {
        if (this.filterSubscription) {
            this.filterSubscription.unsubscribe();
        }
    }

    loadLogs(logfile: string) {
        this.appService.showLoading(true);
        this.diagnoseService.getLogs(<LogsRequest>{ file: logfile }).subscribe(result => {
            this.rawLines = result.body.split('\n');
            this.applyLogFilter();
            this.appService.showLoading(false);
        }, err => {
            this.appService.showLoading(false);
            console.error('get Logs err: ' + err);
        });
    }

    applyLogFilter() {
        const filter = (this.logFilter.value || '').toLowerCase().trim();
        if (!filter) {
            this.content = this.rawLines.join('<br />');
            return;
        }
        const filtered = this.rawLines.filter(line => line.toLowerCase().includes(filter));
        this.content = filtered.join('<br />');
    }

    scrollToTop() {
        if (this.tableView && this.workPanel) {
            this.workPanel.nativeElement.scrollTop = 0;
        } else if (!this.tableView && this.textContent) {
            this.textContent.nativeElement.scrollTop = 0;
        }
    }

    scrollToBottom() {
        if (this.tableView && this.workPanel) {
            this.workPanel.nativeElement.scrollTop = this.workPanel.nativeElement.scrollHeight;
        } else if (!this.tableView && this.textContent) {
            this.textContent.nativeElement.scrollTop = this.textContent.nativeElement.scrollHeight;
        }
    }
}
