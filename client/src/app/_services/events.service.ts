import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import { EndPointApi } from '../_helpers/endpointapi';

@Injectable({
    providedIn: 'root'
})
export class EventsService {

    private endPointConfig: string = EndPointApi.getURL();

    constructor(private http: HttpClient) { }

    getEvents(start: Date, end: Date, filter?: string, userFilter?: string): Observable<any[]> {
        let header = new HttpHeaders({ 'Content-Type': 'application/json' });
        const requestOptions: Object = {
            headers: header,
            params: {
                start: start.getTime(),
                end: end.getTime(),
                filter: filter || '',
                userFilter: userFilter || ''
            },
            observe: 'response'
        };
        return this.http.get<any>(this.endPointConfig + '/api/events', requestOptions).pipe(
            map((response: any) => response?.body || [])
        );
    }

    logEvent(type: string, category: string, user: string, message: string, details?: any): Observable<any> {
        let header = new HttpHeaders({ 'Content-Type': 'application/json' });
        const body = {
            type: type,
            category: category,
            user: user || '',
            message: message || '',
            details: details || {}
        };
        return this.http.post(this.endPointConfig + '/api/events/log', body, { headers: header });
    }
}
