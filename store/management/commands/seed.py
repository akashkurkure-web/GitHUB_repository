"""Load the demo catalogue, coupons and the first admin account (idempotent)."""
import json
import secrets
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from store.models import (
    Address, AuditLog, CartItem, Category, Coupon, Order, Product, Review, User, WishlistItem,
)

DATA = Path(__file__).resolve().parents[2] / 'seed_data.json'


class Command(BaseCommand):
    help = 'Seed demo catalogue, coupons and the admin user. Use --reset to wipe store data first.'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true', help='Delete all store data before seeding')

    @transaction.atomic
    def handle(self, *args, reset=False, **opts):
        if reset:
            for model in (Order, Review, CartItem, WishlistItem, Address, AuditLog, Product, Category, Coupon):
                model.objects.all().delete()
            User.objects.all().delete()

        if Product.objects.exists():
            self.stdout.write('Catalogue already present - nothing to do.')
        else:
            self.seed_catalogue()
        self.ensure_admin()

    def seed_catalogue(self):
        data = json.loads(DATA.read_text(encoding='utf-8'))
        cats = {c['slug']: Category.objects.create(**c) for c in data['categories']}
        now = timezone.now()
        store_name = settings.STORE['NAME']
        days = settings.STORE['RETURN_WINDOW_DAYS']
        for i, p in enumerate(data['products']):
            # Deterministic "marketplace history" so listings look realistic.
            rating_count = 40 + (i * 97) % 4000
            rating = min(round(3.6 + ((i * 37) % 14) / 10, 1), 4.9)
            Product.objects.create(
                title=p['title'], brand=p['brand'], category=cats[p['category']], features=p['features'],
                description=(f"{p['title']} by {p['brand']}. Sold and fulfilled by {store_name}. Covered by our "
                             f"{days}-day easy return policy and 100% purchase protection."),
                price=p['price'] * 100, mrp=p['mrp'] * 100, stock=p['stock'], rating_avg=rating,
                rating_count=rating_count, sold_count=rating_count * 3, emoji=p['emoji'], color=p['color'],
                express=p['express'], is_deal=p['is_deal'], created_at=now - timedelta(hours=i),
            )
        for c in data['coupons']:
            Coupon.objects.create(**c)
        self.stdout.write(self.style.SUCCESS(
            f"Seeded {len(cats)} categories, {len(data['products'])} products, {len(data['coupons'])} coupons."))

    def ensure_admin(self):
        email = settings.STORE['ADMIN_EMAIL'].lower()
        if User.objects.filter(email__iexact=email).exists():
            return
        password = settings.STORE['ADMIN_PASSWORD']
        generated = not password
        if generated:
            password = secrets.token_urlsafe(9) + '9a'
        User.objects.create_superuser(email=email, password=password, name='Store Admin')
        if generated:
            self.stdout.write(self.style.WARNING(
                f'\nAdmin account created: {email}  password: {password}\n'
                'Set ADMIN_EMAIL / ADMIN_PASSWORD to choose your own. This password is shown only once.\n'))
        else:
            self.stdout.write(self.style.SUCCESS(f'Admin account created: {email}'))
