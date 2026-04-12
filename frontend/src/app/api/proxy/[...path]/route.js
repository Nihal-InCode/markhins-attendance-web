import { NextResponse } from 'next/server';

export async function GET(request, { params }) { return proxy(request, params); }
export async function POST(request, { params }) { return proxy(request, params); }
export async function PUT(request, { params }) { return proxy(request, params); }
export async function DELETE(request, { params }) { return proxy(request, params); }

async function proxy(request, params) {
    const segments = (await params).path;
    const path = segments.join('/');
    
    // The Railway backend URL
    const backendBase = 'https://markhins-webapp.up.railway.app';
    const targetUrl = `${backendBase}/${path}${request.nextUrl.search}`;

    console.log(`[Proxy] ${request.method} ${request.nextUrl.pathname} -> ${targetUrl}`);

    try {
        const headers = new Headers(request.headers);
        // Remove host header to avoid SSL/Host mismatch
        headers.delete('host');
        
        let body = null;
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
            try {
                body = await request.text();
            } catch (e) {
                // No body or unreadable
            }
        }

        const response = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
            body: body,
            cache: 'no-store'
        });

        const data = await response.text();
        
        // Forward response headers (except some problematic ones)
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete('content-encoding'); 
        responseHeaders.delete('content-length');

        return new NextResponse(data, {
            status: response.status,
            headers: responseHeaders
        });
    } catch (error) {
        console.error('[Proxy Error]:', error);
        return NextResponse.json({ 
            success: false, 
            message: 'Proxy Error: ' + error.message 
        }, { status: 500 });
    }
}
