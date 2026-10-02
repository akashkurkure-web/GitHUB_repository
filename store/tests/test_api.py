"""Integration and security tests for the storefront API (run: python manage.py test)."""
import json

from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, TestCase, override_settings

from store.models import Order, Product

ADMIN = {'email': 'admin@bazaario.local', 'password': 'AdminPass123'}


class Api:
    """Cookie-aware JSON client that behaves like the storefront (sends X-CSRF-Token)."""

    def __init__(self):
        self.c = Client(enforce_csrf_checks=True)
        self.csrf = self.call('GET', '/auth/me')[1]['csrfToken']

    def call(self, method, path, data=None, csrf=True, **headers):
        kwargs = {'content_type': 'application/json'}
        if data is not None:
            kwargs['data'] = json.dumps(data)
        if csrf and method != 'GET' and getattr(self, 'csrf', None):
            headers.setdefault('HTTP_X_CSRF_TOKEN', self.csrf)
        resp = getattr(self.c, method.lower())('/api' + path, **kwargs, **headers)
        body = resp.json() if resp.get('Content-Type', '').startswith('application/json') else {}
        if body.get('csrfToken'):
            self.csrf = body['csrfToken']
        return resp.status_code, body, resp


@override_settings(STORE={**__import__('django.conf', fromlist=['settings']).settings.STORE,
                          'ADMIN_PASSWORD': ADMIN['password']})
class StoreApiTests(TestCase):
    n = 0

    @classmethod
    def setUpTestData(cls):
        call_command('seed', stdout=open('/dev/null', 'w'))

    def setUp(self):
        cache.clear()

    def customer(self):
        StoreApiTests.n += 1
        a = Api()
        status, _, _ = a.call('POST', '/auth/register',
                              {'name': 'Test User', 'email': f'u{self.n}@example.com', 'password': 'secret123'})
        self.assertEqual(status, 201)
        return a

    def address(self, a):
        status, body, _ = a.call('POST', '/addresses', {
            'fullName': 'Test User', 'phone': '9876543210', 'line1': '12 MG Road', 'city': 'Pune',
            'state': 'Maharashtra', 'pincode': '411001'})
        self.assertEqual(status, 201)
        return body['id']

    def admin(self):
        a = Api()
        self.assertEqual(a.call('POST', '/auth/login', ADMIN)[0], 200)
        return a

    # ---------------------------------------------------------------- catalog
    def test_catalog_search_filters_detail(self):
        a = Api()
        self.assertEqual(len(a.call('GET', '/categories')[1]['categories']), 10)
        items = a.call('GET', '/products?q=watch')[1]['items']
        self.assertTrue(any('Watch' in p['title'] for p in items))
        cheap = a.call('GET', '/products?max=500&sort=price-asc')[1]['items']
        self.assertTrue(cheap and all(p['price'] <= 50000 for p in cheap))
        status, body, _ = a.call('GET', '/products/1')
        self.assertEqual(status, 200)
        self.assertIsInstance(body['product']['features'], list)
        self.assertEqual(a.call('GET', '/products/99999')[0], 404)

    def test_security_headers(self):
        _, _, resp = Api().call('GET', '/categories')
        self.assertIn("default-src 'self'", resp['Content-Security-Policy'])
        self.assertEqual(resp['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(resp['X-Frame-Options'], 'DENY')
        self.assertEqual(resp['Cache-Control'], 'no-store')

    def test_sql_injection_is_plain_text(self):
        status, body, _ = Api().call('GET', "/products?q=' OR 1=1 --")
        self.assertEqual(status, 200)
        self.assertEqual(body['total'], 0)

    # ---------------------------------------------------------------- auth
    def test_register_validation_duplicates_and_generic_login_errors(self):
        a = Api()
        self.assertEqual(a.call('POST', '/auth/register', {'name': 'A B', 'email': 'w@example.com', 'password': 'short'})[0], 400)
        self.assertEqual(a.call('POST', '/auth/register', {'name': 'A B', 'email': 'bad', 'password': 'secret123'})[0], 400)
        self.assertEqual(a.call('POST', '/auth/register', {'name': 'A B', 'email': 'dup@example.com', 'password': 'secret123'})[0], 201)
        self.assertEqual(Api().call('POST', '/auth/register', {'name': 'A B', 'email': 'DUP@example.com', 'password': 'secret123'})[0], 409)
        unknown = Api().call('POST', '/auth/login', {'email': 'nobody@example.com', 'password': 'secret123'})
        wrong = Api().call('POST', '/auth/login', {'email': 'dup@example.com', 'password': 'wrong1234'})
        self.assertEqual(unknown[0], 401)
        self.assertEqual(unknown[1]['error'], wrong[1]['error'], 'no user enumeration')
        status, body, _ = Api().call('POST', '/auth/login', {'email': 'dup@example.com', 'password': 'secret123'})
        self.assertEqual(status, 200)
        self.assertNotIn('password', body['user'])

    def test_session_cookie_flags(self):
        a = Api()
        _, _, resp = a.call('POST', '/auth/register', {'name': 'Cookie T', 'email': 'cookie@example.com', 'password': 'secret123'})
        morsel = resp.cookies['sid']
        self.assertTrue(morsel['httponly'])
        self.assertEqual(morsel['samesite'], 'Lax')

    def test_account_locks_after_five_failures(self):
        Api().call('POST', '/auth/register', {'name': 'Lock Me', 'email': 'lock@example.com', 'password': 'secret123'})
        for _ in range(5):
            Api().call('POST', '/auth/login', {'email': 'lock@example.com', 'password': 'badpass99'})
        self.assertEqual(Api().call('POST', '/auth/login', {'email': 'lock@example.com', 'password': 'secret123'})[0], 423)

    def test_csrf_missing_token_and_cross_origin_rejected(self):
        a = self.customer()
        self.assertEqual(a.call('POST', '/cart', {'productId': 1}, csrf=False)[0], 403)
        self.assertEqual(a.call('POST', '/cart', {'productId': 1}, HTTP_ORIGIN='https://evil.example')[0], 403)
        self.assertEqual(a.call('POST', '/cart', {'productId': 1})[0], 201)

    def test_access_control_and_no_idor(self):
        self.assertEqual(Api().call('GET', '/cart')[0], 401)
        a, b = self.customer(), self.customer()
        self.assertEqual(a.call('GET', '/admin/stats')[0], 403)
        addr = self.address(a)
        a.call('POST', '/cart', {'productId': 3, 'qty': 1})
        status, order, _ = a.call('POST', '/orders', {'addressId': addr, 'paymentMethod': 'cod'})
        self.assertEqual(status, 201)
        self.assertEqual(b.call('GET', f"/orders/{order['orderId']}")[0], 404)
        self.assertEqual(b.call('POST', f"/orders/{order['orderId']}/cancel")[0], 404)
        b.call('DELETE', f'/addresses/{addr}')
        self.assertEqual(len(a.call('GET', '/addresses')[1]['addresses']), 1)
        b.call('POST', '/cart', {'productId': 3})
        self.assertEqual(b.call('POST', '/orders', {'addressId': addr, 'paymentMethod': 'cod'})[0], 400)

    # ---------------------------------------------------------------- commerce
    def test_cart_limits_enforced_server_side(self):
        a = self.customer()
        self.assertEqual(a.call('POST', '/cart', {'productId': 1, 'qty': 11})[0], 400)
        low = Product.objects.order_by('stock').first()
        self.assertEqual(a.call('POST', '/cart', {'productId': low.id, 'qty': low.stock + 1})[0], 400)
        self.assertEqual(a.call('POST', '/cart', {'productId': low.id, 'qty': 1})[0], 201)
        self.assertEqual(a.call('PATCH', f'/cart/{low.id}', {'qty': 0})[0], 400)

    def test_checkout_pricing_coupon_payment_idempotency(self):
        a = self.customer()
        addr = self.address(a)
        p = a.call('GET', '/products/5')[1]['product']  # ₹2,999 earbuds
        a.call('POST', '/cart', {'productId': p['id'], 'qty': 1, 'price': 1})  # client price ignored
        q = a.call('POST', '/checkout/quote', {'coupon': 'WELCOME10'})[1]
        self.assertEqual(q['subtotal'], p['price'])
        self.assertEqual(q['discount'], 20000)
        self.assertEqual(q['shipping'], 0)
        self.assertEqual(q['total'], p['price'] - 20000)
        bad = {'cardNumber': '4111111111111112', 'expiry': '12/30', 'cvv': '123'}
        self.assertEqual(a.call('POST', '/orders', {'addressId': addr, 'paymentMethod': 'card', 'payment': bad})[0], 400)
        expired = {'cardNumber': '4111111111111111', 'expiry': '01/20', 'cvv': '123'}
        self.assertEqual(a.call('POST', '/orders', {'addressId': addr, 'paymentMethod': 'card', 'payment': expired})[0], 400)
        good = {'addressId': addr, 'paymentMethod': 'card', 'coupon': 'WELCOME10', 'idempotencyKey': 'test-key-123456',
                'payment': {'cardNumber': '4111 1111 1111 1111', 'expiry': '12/30', 'cvv': '123'}}
        status, order, _ = a.call('POST', '/orders', good)
        self.assertEqual(status, 201)
        self.assertEqual(order['total'], p['price'] - 20000)
        dup = a.call('POST', '/orders', {**good, 'payment': {}})[1]
        self.assertEqual(dup['orderId'], order['orderId'])
        detail = a.call('GET', f"/orders/{order['orderId']}")[1]['order']
        self.assertEqual(detail['payment_status'], 'paid')
        self.assertRegex(detail['payment_ref'], r'^CARD-xxxx1111-')
        self.assertNotIn('4111111111111111', json.dumps(detail))
        self.assertEqual(a.call('GET', '/cart')[1]['count'], 0)
        self.assertEqual(Product.objects.get(id=5).stock, p['stock'] - 1)

    def test_cancel_restock_fulfilment_review_return_audit(self):
        admin = self.admin()
        a = self.customer()
        addr = self.address(a)
        before = Product.objects.get(id=20).stock
        a.call('POST', '/cart', {'productId': 20, 'qty': 2})
        o1 = a.call('POST', '/orders', {'addressId': addr, 'paymentMethod': 'upi', 'payment': {'upiId': 'test@okbank'}})[1]
        self.assertEqual(a.call('POST', f"/orders/{o1['orderId']}/cancel")[1]['order']['status'], 'cancelled')
        self.assertEqual(Product.objects.get(id=20).stock, before)

        a.call('POST', '/cart', {'productId': 20, 'qty': 1})
        o2 = a.call('POST', '/orders', {'addressId': addr, 'paymentMethod': 'cod'})[1]
        self.assertEqual(admin.call('PATCH', f"/admin/orders/{o2['orderId']}", {'status': 'delivered'})[0], 400)
        for s in ('packed', 'shipped', 'delivered'):
            self.assertEqual(admin.call('PATCH', f"/admin/orders/{o2['orderId']}", {'status': s})[0], 200)
        self.assertEqual(Order.objects.get(id=o2['orderId']).payment_status, 'paid')
        self.assertEqual(a.call('POST', f"/orders/{o2['orderId']}/cancel")[0], 400)

        status, body, _ = a.call('POST', '/products/20/reviews', {'rating': 5, 'title': 'Great book', 'body': 'Really enjoyed reading this one.'})
        self.assertEqual(status, 201)
        self.assertTrue(body['verified'])
        self.assertEqual(a.call('POST', '/products/20/reviews', {'rating': 4, 'title': 'Again', 'body': 'Trying to review twice.'})[0], 409)
        self.assertEqual(a.call('POST', f"/orders/{o2['orderId']}/return")[1]['order']['status'], 'return_requested')
        actions = [e['action'] for e in admin.call('GET', '/admin/audit')[1]['entries']]
        self.assertIn('order.return_request', actions)

    def test_admin_product_validation_and_soft_delete(self):
        admin = self.admin()
        bad = {'title': 'Thing', 'brand': 'X', 'categoryId': 1, 'price': 200, 'mrp': 100, 'stock': 5}
        self.assertEqual(admin.call('POST', '/admin/products', bad)[0], 400)
        xss = '<img src=x onerror=alert(1)>'
        status, body, _ = admin.call('POST', '/admin/products', {**bad, 'title': xss, 'price': 100, 'mrp': 200})
        self.assertEqual(status, 201)
        self.assertEqual(Api().call('GET', f"/products/{body['id']}")[1]['product']['title'], xss)  # data, rendered as text
        admin.call('DELETE', f"/admin/products/{body['id']}")
        self.assertEqual(Api().call('GET', f"/products/{body['id']}")[0], 404)

    def test_password_change_signs_out_other_sessions(self):
        a = Api()
        a.call('POST', '/auth/register', {'name': 'Pw Change', 'email': 'pw@example.com', 'password': 'secret123'})
        b = Api()
        b.call('POST', '/auth/login', {'email': 'pw@example.com', 'password': 'secret123'})
        self.assertEqual(a.call('POST', '/auth/change-password', {'currentPassword': 'secret123', 'newPassword': 'newsecret456'})[0], 200)
        self.assertEqual(b.call('GET', '/cart')[0], 401)
        self.assertEqual(a.call('GET', '/cart')[0], 200)

    def test_storefront_served(self):
        resp = Client().get('/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'Bazaario', b''.join(resp.streaming_content) if resp.streaming else resp.content)
