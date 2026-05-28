import { Component, AfterViewInit, ViewChild } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table';
import { MatPaginator } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { FormControl, FormGroup } from '@angular/forms';

import { EventsService } from '../_services/events.service';
import * as moment from 'moment';

@Component({
    selector: 'app-events-history',
    templateUrl: './events-history.component.html',
    styleUrls: ['./events-history.component.scss']
})
export class EventsHistoryComponent implements AfterViewInit {

    displayColumns: string[] = ['timestamp', 'type', 'user', 'details'];
    dataSource = new MatTableDataSource([]);
    eventsLoading = false;
    dateRange: FormGroup;
    filter = new FormControl('');
    userFilter = new FormControl('');

    @ViewChild(MatSort, { static: false }) sort: MatSort;
    @ViewChild(MatPaginator, { static: false }) paginator: MatPaginator;

    constructor(private eventsService: EventsService) {
        const today = moment();
        this.dateRange = new FormGroup({
            endDate: new FormControl(today.clone().set({ hour: 23, minute: 59, second: 59, millisecond: 999 }).toDate()),
            startDate: new FormControl(today.clone().set({ hour: 0, minute: 0, second: 0, millisecond: 0 }).add(-3, 'day').toDate())
        });
    }

    ngAfterViewInit() {
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
        this.onSearch();
    }

    onSearch() {
        const start = new Date(this.dateRange.value.startDate);
        const end = new Date(this.dateRange.value.endDate);
        end.setHours(23, 59, 59, 999);
        const filterText = this.filter.value || '';
        const userFilterText = this.userFilter.value || '';
        this.eventsLoading = true;
        this.eventsService.getEvents(start, end, filterText, userFilterText).subscribe(
            (result: any[]) => {
                this.dataSource.data = result.map((row: any) => {
                    try {
                        row.details = JSON.parse(row.details);
                    } catch (e) {
                        // keep as string
                    }
                    return row;
                });
                this.eventsLoading = false;
            },
            (err: any) => {
                console.error('Error loading events', err);
                this.eventsLoading = false;
            }
        );
    }
}
