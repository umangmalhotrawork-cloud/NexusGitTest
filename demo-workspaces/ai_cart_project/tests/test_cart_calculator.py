"""
Unit test suite for cart_calculator.py
"""
import sys
import os

# Ensure src/ is on Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'src')))

from cart_calculator import calculate_cart_total

def test_calculate_cart_total_standard():
    items = [
        {"price": 25.0, "quantity": 2},
        {"price": 10.0, "quantity": 1}
    ]
    # Subtotal: 60.0, Tax (8%): 4.80, Total: 64.80
    total = calculate_cart_total(items)
    assert total == 64.80

def test_calculate_cart_total_with_summer_discount():
    items = [
        {"price": 100.0, "quantity": 1}
    ]
    # Subtotal: 100.0, Discount (10%): 10.00, Taxable: 90.00, Tax (8%): 7.20, Total: 97.20
    total = calculate_cart_total(items, discount_code="SUMMER10")
    assert total == 97.20

def test_calculate_cart_total_failing_mismatch():
    items = [
        {"price": 50.0, "quantity": 2}
    ]
    total = calculate_cart_total(items)
    # Deliberately failing test assertion to test BreakageCorrelator failure path
    assert total == 999.99, f"AssertionError: Expected 999.99 but got {total}"

if __name__ == '__main__':
    test_calculate_cart_total_standard()
    test_calculate_cart_total_with_summer_discount()
    print("All passing tests executed successfully.")
