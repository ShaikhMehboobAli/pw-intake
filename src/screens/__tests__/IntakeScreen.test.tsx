import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CategoryDef } from '../../categories';
import { IntakeScreen } from '../IntakeScreen';

const photo = { uri: 'file:///cache/a.jpg', name: 'a.jpg', type: 'image/jpeg' };

async function fillExcavator() {
  await fireEvent.changeText(screen.getByLabelText('Make'), 'CAT');
  await fireEvent.changeText(screen.getByLabelText('Model'), '320');
  await fireEvent.changeText(screen.getByLabelText('Hours'), '4200');
  await fireEvent.press(screen.getByRole('button', { name: 'Good' }));
  await fireEvent.press(screen.getByText('From library'));
}

const setup = (enqueue: jest.Mock, categories?: CategoryDef[]) => {
  const notify = jest.fn();
  const pickPhoto = jest.fn().mockResolvedValue(photo);
  return { notify, pickPhoto, ui: <IntakeScreen outbox={{ enqueue }} notify={notify} pickPhoto={pickPhoto} categories={categories} /> };
};

describe('IntakeScreen', () => {
  it('queues a valid submission, then clears the form', async () => {
    const enqueue = jest.fn().mockResolvedValue({});
    const { ui, notify } = setup(enqueue);
    await render(ui);
    await fillExcavator();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit for appraisal' }));

    expect(enqueue).toHaveBeenCalledWith({
      category: 'excavator',
      fields: { make: 'CAT', model: '320', hours: 4200, condition: 'Good' },
      photos: [photo],
    });
    expect(notify).toHaveBeenCalledWith('Saved', expect.any(String));
    expect(screen.getByLabelText('Make')).toHaveDisplayValue('');
  });

  it('keeps everything the dealer entered if the phone could not save it (the original bug)', async () => {
    const enqueue = jest.fn().mockRejectedValue(new Error('disk full'));
    const { ui, notify } = setup(enqueue);
    await render(ui);
    await fillExcavator();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit for appraisal' }));

    expect(notify).toHaveBeenCalledWith("Couldn't save on this phone", expect.stringContaining('disk full'));
    expect(screen.getByLabelText('Make')).toHaveDisplayValue('CAT');
    expect(screen.getByLabelText('Hours')).toHaveDisplayValue('4200');
    expect(screen.getByText(/Photos \(1/)).toBeOnTheScreen();
  });

  it('shows validation errors and does not queue an incomplete submission', async () => {
    const enqueue = jest.fn();
    const { ui } = setup(enqueue);
    await render(ui);
    await fireEvent.press(screen.getByRole('button', { name: 'Submit for appraisal' }));
    expect(enqueue).not.toHaveBeenCalled();
    expect(screen.getByText('Make is required')).toBeOnTheScreen();
    expect(screen.getByText('Add at least 1 photo')).toBeOnTheScreen();
  });

  it('renders and submits a second category purely from config', async () => {
    const trailer: CategoryDef = {
      id: 'trailer',
      label: 'Trailer',
      fields: [{ key: 'axles', label: 'Axles', kind: 'number', required: true, integer: true, min: 1 }],
      minPhotos: 0,
      maxPhotos: 5,
      titleFields: ['axles'],
    };
    const enqueue = jest.fn().mockResolvedValue({});
    const { excavator } = jest.requireActual('../../categories/excavator');
    const { ui } = setup(enqueue, [excavator, trailer]);
    await render(ui);

    await fireEvent.press(screen.getByRole('button', { name: 'Trailer' }));
    expect(screen.getByText('New trailer')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Make')).not.toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Axles'), '2');
    await fireEvent.press(screen.getByRole('button', { name: 'Submit for appraisal' }));
    expect(enqueue).toHaveBeenCalledWith({ category: 'trailer', fields: { axles: 2 }, photos: [] });
  });
});
