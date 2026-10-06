from functools import wraps

from django.contrib.auth.decorators import login_required
from django.core.exceptions import PermissionDenied


def check(test):
    """Login required, then `test(user)` must be true or the request gets 403."""

    def decorator(view):
        @login_required
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if not test(request.user):
                raise PermissionDenied
            return view(request, *args, **kwargs)

        return wrapper

    return decorator


staff_required = check(lambda u: u.is_staff_member)
owner_required = check(lambda u: u.is_owner)
customer_required = check(lambda u: u.is_customer)
vendor_required = check(lambda u: u.is_vendor)
